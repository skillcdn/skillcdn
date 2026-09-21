import { createMcpHandler } from "@modelcontextprotocol/server";
import { formatAddress, parseAddress } from "@skillcdn/core";
import { type Database, getSchemaStatus } from "@skillcdn/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { createMountServer, type ToolDependencies } from "../mcp/tools.js";
import { type Mount, MountError, type MountService } from "../mounts/mount-service.js";

export interface AppDependencies {
  readonly database: Database;
  readonly mounts: MountService;
  readonly snapshots: SnapshotService;
  readonly tools: ToolDependencies;
  readonly logger: Logger;
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

export function createApp(dependencies: AppDependencies): Hono {
  const { database, mounts, snapshots, tools, logger, isShuttingDown } = dependencies;
  const app = new Hono();

  // The MCP handler builds a server per request. The mount it serves is resolved by the route
  // below before the handler runs, and handed over through this map.
  const mountOf = new WeakMap<Request, Mount>();
  const mcp = createMcpHandler(
    async (context) => {
      const request = context.requestInfo;
      let mount = request === undefined ? undefined : mountOf.get(request);
      if (mount === undefined && request !== undefined) {
        // The handler passed on a different Request object than the one it was given.
        const parsed = parseAddress(new URL(request.url).pathname);
        mount = parsed.ok ? await mounts.resolve(parsed.value) : undefined;
      }
      if (mount === undefined) {
        throw new Error("no mount was resolved for this request");
      }
      return createMountServer(mount, tools);
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

  app.all(
    "/gh/*",
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      // The raw path, percent-escapes included: the address parser decodes exactly once.
      const parsed = parseAddress(new URL(c.req.url).pathname);
      if (!parsed.ok) {
        return c.json(errorBody(`address.${parsed.error.code}`, parsed.error.message), 400);
      }
      const address = parsed.value;

      let mount: Mount;
      try {
        mount = await mounts.resolve(address);
      } catch (error) {
        if (error instanceof MountError) {
          if (error.retryAfterSeconds !== undefined) {
            c.header("retry-after", String(error.retryAfterSeconds));
          }
          // Missing and forbidden repositories share one code and one message.
          return c.json(errorBody(error.code, error.detail), STATUS_BY_REASON[error.reason]);
        }
        logger.error({ err: error, address: formatAddress(address) }, "mount resolution failed");
        return c.json(errorBody("internal", "The request could not be served."), 500);
      }

      // Connecting is enough to start indexing, so the first tool call finds it done or underway.
      snapshots.warm(mount).catch((error: unknown) => {
        logger.warn({ err: error, address: formatAddress(address) }, "could not start indexing");
      });

      mountOf.set(c.req.raw, mount);
      const response = await mcp.fetch(c.req.raw);
      // Public content, but a moving ref: caches between us and the client must not pin it.
      response.headers.set("cache-control", "no-store");
      return response;
    },
  );

  app.notFound((c) => c.json(errorBody("not_found", "There is nothing at this path."), 404));
  app.onError((error, c) => {
    logger.error({ err: error }, "unhandled request error");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  });

  return app;
}
