import { createMcpHandler } from "@modelcontextprotocol/server";
import { type Address, formatAddress, parseAddress } from "@skillcdn/core";
import { type Database, getSchemaStatus } from "@skillcdn/db";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { createMountServer, type ToolDependencies } from "../mcp/tools.js";
import type { MountReader } from "../mounts/mount-reader.js";
import { type Mount, MountError, type MountService } from "../mounts/mount-service.js";
import type { ClientAddressResolver } from "./client-address.js";
import { type AppEnv, requestContext } from "./request-context.js";
import { registerRest } from "./rest.js";
import { type WebBundle, type WebRequest, wantsHtml } from "./web.js";

export interface AppDependencies {
  readonly database: Database;
  readonly mounts: MountService;
  readonly snapshots: SnapshotService;
  readonly reader: MountReader;
  readonly tools: ToolDependencies;
  /** Addresses shown on the front page of the explorer. */
  readonly featured: readonly Address[];
  /** A build of the web UI to serve. Left out, the server is MCP and REST only. */
  readonly web: WebBundle | undefined;
  readonly logger: Logger;
  readonly requests: {
    readonly addresses: ClientAddressResolver;
    readonly requestIdHeader: string;
    readonly accessLog: boolean;
    readonly newRequestId: () => string;
    readonly now: () => number;
  };
  /** True once shutdown has begun: readiness fails so that the platform stops sending traffic. */
  readonly isShuttingDown: () => boolean;
}

/** JSON-RPC messages are small. This is the ceiling for anything a client may send. */
const MAX_REQUEST_BYTES = 1024 * 1024;

const STATUS_BY_REASON = {
  repo_not_found: 404,
  ref_not_found: 404,
  not_allowed: 403,
  rate_limited: 503,
  unavailable: 503,
} as const;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const { database, mounts, snapshots, reader, tools, logger, isShuttingDown, web } = dependencies;
  const webRequestOf = (c: Context<AppEnv>): WebRequest => ({
    method: c.req.method,
    url: new URL(c.req.url),
    headers: c.req.raw.headers,
  });
  const app = new Hono<AppEnv>();
  app.use(requestContext({ logger, ...dependencies.requests }));

  // The MCP handler builds a server per request. The mount it serves is resolved by the route
  // below before the handler runs, and handed over through this map.
  const resolvedFor = new WeakMap<Request, { mount: Mount; requestId: string }>();
  const mcp = createMcpHandler(
    async (context) => {
      const request = context.requestInfo;
      const resolved = request === undefined ? undefined : resolvedFor.get(request);
      let mount = resolved?.mount;
      if (mount === undefined && request !== undefined) {
        // The handler passed on a different Request object than the one it was given.
        const parsed = parseAddress(new URL(request.url).pathname);
        mount = parsed.ok ? await mounts.resolve(parsed.value) : undefined;
      }
      if (mount === undefined) {
        throw new Error("no mount was resolved for this request");
      }
      return createMountServer(mount, {
        ...tools,
        logger: tools.logger.child({ requestId: resolved?.requestId }),
      });
    },
    {
      onerror: (error) => logger.warn({ err: error }, "mcp handler error"),
    },
  );

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", async (c) => {
    c.header("cache-control", "no-store");
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }
    if (!(await database.ping())) {
      return c.json({ status: "database_unreachable" }, 503);
    }
    const schema = await getSchemaStatus(database);
    return schema.current
      ? c.json({ status: "ready" })
      : c.json({ status: "schema_behind", expected: schema.expected }, 503);
  });

  const startIndexing = (mount: Mount): void => {
    snapshots.warm(mount).catch((error: unknown) => {
      logger.warn(
        { err: error, address: formatAddress(mount.address) },
        "could not start indexing",
      );
    });
  };

  /**
   * Resolves the address in the request path after `prefix`, or answers with the error. Asking
   * about an address is enough to start indexing it, so the next question finds it done or underway.
   */
  const mountAt = async (c: Context<AppEnv>, prefix: string): Promise<Mount | Response> => {
    // The raw path, percent-escapes included: the address parser decodes exactly once.
    const parsed = parseAddress(new URL(c.req.url).pathname.slice(prefix.length));
    if (!parsed.ok) {
      return c.json(errorBody(`address.${parsed.error.code}`, parsed.error.message), 400);
    }
    const address = parsed.value;
    try {
      const mount = await mounts.resolve(address);
      startIndexing(mount);
      return mount;
    } catch (error) {
      if (error instanceof MountError) {
        if (error.retryAfterSeconds !== undefined) {
          c.header("retry-after", String(error.retryAfterSeconds));
        }
        // Missing and forbidden repositories share one code and one message.
        return c.json(errorBody(error.code, error.detail), STATUS_BY_REASON[error.reason]);
      }
      logger.error(
        { err: error, address: formatAddress(address), requestId: c.get("requestId") },
        "mount resolution failed",
      );
      return c.json(errorBody("internal", "The request could not be served."), 500);
    }
  };

  registerRest(app, {
    reader,
    logger,
    mountAt,
    mountOf: async (address) => {
      try {
        const mount = await mounts.resolve(address);
        startIndexing(mount);
        return mount;
      } catch (error) {
        if (error instanceof MountError) {
          return undefined;
        }
        throw error;
      }
    },
    featured: dependencies.featured,
    now: dependencies.requests.now,
  });

  app.all(
    "/gh/*",
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      // An address answers a browser with the explorer and everything else with MCP. The page
      // asks the REST API for what it shows, so serving it resolves and indexes nothing.
      if (web !== undefined && wantsHtml(webRequestOf(c))) {
        return web.shell(webRequestOf(c));
      }
      const mount = await mountAt(c, "");
      if (mount instanceof Response) {
        return mount;
      }
      // Every MCP message is a POST, whichever protocol revision the client speaks; a client
      // that sent one used this repository today.
      if (c.req.method === "POST") {
        tools.stats.client(mount, c.get("clientAddress"));
      }
      resolvedFor.set(c.req.raw, { mount, requestId: c.get("requestId") });
      const response = await mcp.fetch(c.req.raw);
      // Public content, but a moving ref: caches between us and the client must not pin it.
      response.headers.set("cache-control", "no-store");
      return response;
    },
  );

  if (web !== undefined) {
    app.on(["GET", "HEAD"], "*", (c) => web.respond(webRequestOf(c)) ?? c.notFound());
  }

  app.notFound((c) =>
    web !== undefined && wantsHtml(webRequestOf(c))
      ? web.notFound(webRequestOf(c))
      : c.json(errorBody("not_found", "There is nothing at this path."), 404),
  );
  app.onError((error, c) => {
    logger.error({ err: error, requestId: c.get("requestId") }, "unhandled request error");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  });

  return app;
}
