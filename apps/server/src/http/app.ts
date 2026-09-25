import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  type Address,
  formatAddress,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  parseAddress,
  REST_MOUNT_LIST_LIMIT,
} from "@skillcdn/core";
import { type Database, getSchemaStatus, listTopRepositories, usageDayOf } from "@skillcdn/db";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import * as z from "zod";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { createMountServer, type ToolDependencies } from "../mcp/tools.js";
import { ReaderInputError } from "../mounts/continuation.js";
import type { MountReader } from "../mounts/mount-reader.js";
import { type Mount, MountError, type MountService } from "../mounts/mount-service.js";
import type { ClientAddressResolver } from "./client-address.js";
import { type AppEnv, requestContext } from "./request-context.js";
import {
  browseBody,
  CORS_MAX_AGE_SECONDS,
  findBody,
  hostFailure,
  mountBody,
  registerRest,
  skillOutcome,
} from "./rest.js";
import { type AddressData, type WebBundle, type WebRequest, wantsHtml } from "./web.js";

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
const pageQuery = z.object({
  skill: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
  file: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
  path: z.string().max(MAX_REPO_PATH_LENGTH).optional(),
  q: z.string().max(MAX_QUERY_LENGTH).optional(),
  query: z.string().max(MAX_QUERY_LENGTH).optional(),
});

const STATUS_BY_REASON = {
  repo_not_found: 404,
  ref_not_found: 404,
  not_allowed: 403,
  rate_limited: 503,
  unavailable: 503,
} as const;

/**
 * What the sitemap lists besides the pages of the build: the featured addresses, and the
 * repositories that the most distinct clients used lately. One client is not popularity, and
 * would let anyone put a repository into the sitemap by asking for it once.
 */
const SITEMAP_DAYS = 30;
const SITEMAP_TOP_REPOSITORIES = 500;
const SITEMAP_MIN_CLIENTS = 2;
const SITEMAP_CACHE_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

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
  const resolvedFor = new WeakMap<Request, { mount: Mount; requestId: string; origin: string }>();
  /** Where the pages of this deployment are, as far as a request can tell. */
  const originOf = (url: string): string => tools.publicUrl ?? new URL(url).origin;
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
      if (mount === undefined || request === undefined) {
        throw new Error("no mount was resolved for this request");
      }
      return await createMountServer(
        mount,
        { ...tools, logger: tools.logger.child({ requestId: resolved?.requestId }) },
        { origin: resolved?.origin ?? originOf(request.url) },
      );
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

  /**
   * The page of an address for a browser, rendered with what the address serves: the same
   * answers the page would otherwise ask the REST API for, so that a crawler reads what a
   * person sees. Serving the page resolves the address and starts indexing it, like the API.
   */
  const addressPage = async (c: Context<AppEnv>, bundle: WebBundle): Promise<Response> => {
    const request = webRequestOf(c);
    const parsed = parseAddress(request.url.pathname);
    if (!parsed.ok) {
      // The page explains what is wrong with the address; the status says it is nothing.
      return bundle.address(request, {}, 404);
    }
    const query = pageQuery.safeParse(c.req.query());
    if (!query.success) {
      return bundle.address(
        request,
        {
          mount: {
            error: {
              status: 400,
              code: "request.invalid",
              message: "Missing or malformed page parameters.",
            },
          },
        },
        400,
      );
    }
    let mount: Mount;
    try {
      mount = await mounts.resolve(parsed.value);
      startIndexing(mount);
    } catch (error) {
      if (error instanceof MountError) {
        const status = STATUS_BY_REASON[error.reason];
        return bundle.address(
          request,
          { mount: { error: { status, code: error.code, message: error.detail } } },
          status,
        );
      }
      throw error;
    }
    try {
      const data: {
        mount: AddressData["mount"];
        skill?: AddressData["skill"];
        browse?: AddressData["browse"];
        find?: AddressData["find"];
      } = {
        mount: { ready: mountBody(mount, await reader.overview(mount, REST_MOUNT_LIST_LIMIT)) },
      };
      const wanted = query.data.skill;
      if (wanted !== undefined) {
        const outcome = skillOutcome(await reader.skill(mount, wanted, 0, undefined, true));
        data.skill =
          "body" in outcome
            ? { ready: outcome.body }
            : {
                error: {
                  status: outcome.failure.status,
                  code: outcome.failure.code,
                  message: outcome.failure.message,
                  ...(outcome.failure.directories === undefined
                    ? {}
                    : { directories: outcome.failure.directories }),
                },
              };
      }
      if (wanted === undefined && query.data.file === undefined) {
        const path = query.data.path;
        const search = query.data.q ?? query.data.query;
        if (search !== undefined && search.trim().length > 0)
          data.find = { ready: findBody(await reader.find(mount, { query: search, path }, 0)) };
        else data.browse = { ready: browseBody(await reader.browse(mount, { path }, 0)) };
      }
      return bundle.address(request, data);
    } catch (error) {
      if (error instanceof ReaderInputError) {
        return bundle.address(
          request,
          {
            mount: { error: { status: 400, code: error.code, message: error.message } },
          },
          400,
        );
      }
      const known = hostFailure(error);
      if (known === undefined) {
        throw error;
      }
      const { status, code, message } = known;
      return bundle.address(request, { mount: { error: { status, code, message } } }, status);
    }
  };

  // Public content, anonymous and read-only: a page on any origin may reach the endpoint, as it
  // may reach the REST API. No cookies are involved, so credentials are never allowed.
  app.use(
    "/gh/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: [
        "accept",
        "authorization",
        "content-type",
        "mcp-method",
        "mcp-name",
        "mcp-protocol-version",
        "mcp-session-id",
      ],
      exposeHeaders: ["mcp-protocol-version", "mcp-session-id", "retry-after", "x-request-id"],
      maxAge: CORS_MAX_AGE_SECONDS,
    }),
  );

  app.all(
    "/gh/*",
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      // An address answers a browser with the explorer and everything else with MCP.
      if (web !== undefined && wantsHtml(webRequestOf(c))) {
        return addressPage(c, web);
      }
      const mount = await mountAt(c, "");
      if (mount instanceof Response) {
        return mount;
      }
      let request = c.req.raw;
      if (c.req.method === "POST") {
        // A JSON-RPC batch would let one request carry thousands of calls, and no protocol
        // revision the server speaks needs one: an array body is refused before the handler.
        const body = await c.req.text();
        if (/^\s*\[/.test(body)) {
          return c.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "JSON-RPC batches are not supported." },
            },
            400,
          );
        }
        request = new Request(c.req.raw.url, { method: "POST", headers: c.req.raw.headers, body });
        // Every MCP message is a POST, whichever protocol revision the client speaks; a client
        // that sent one used this repository today.
        tools.stats.client(mount, c.get("clientAddress"));
      }
      resolvedFor.set(request, {
        mount,
        requestId: c.get("requestId"),
        origin: originOf(c.req.url),
      });
      const response = await mcp.fetch(request);
      // Public content, but a moving ref: caches between us and the client must not pin it.
      response.headers.set("cache-control", "no-store");
      return response;
    },
  );

  if (web !== undefined) {
    const bundle = web;
    let listed: { readonly until: number; readonly addresses: Promise<string[]> } | undefined;

    /** The addresses the sitemap lists: featured ones, then the popular ones, without repeats. */
    const listedAddresses = async (): Promise<string[]> => {
      const paths = new Set(dependencies.featured.map(formatAddress));
      try {
        const now = tools.clock.now();
        const top = await listTopRepositories(database, {
          metric: "client",
          from: usageDayOf(new Date(now.getTime() - SITEMAP_DAYS * DAY_MS)),
          to: usageDayOf(now),
          limit: SITEMAP_TOP_REPOSITORIES,
          minimum: SITEMAP_MIN_CLIENTS,
        });
        for (const repository of top) {
          const parsed = parseAddress(`/${repository.host}/${repository.owner}/${repository.name}`);
          if (parsed.ok) {
            paths.add(formatAddress(parsed.value));
          }
        }
      } catch (error) {
        logger.warn({ err: error }, "popular repositories could not be listed for the sitemap");
      }
      return [...paths];
    };

    app.get("/sitemap.xml", async (c) => {
      const now = dependencies.requests.now();
      if (listed === undefined || listed.until <= now) {
        const addresses = listedAddresses();
        listed = { until: now + SITEMAP_CACHE_MS, addresses };
      }
      return bundle.sitemap(webRequestOf(c), await listed.addresses);
    });

    app.on(["GET", "HEAD"], "*", (c) => bundle.respond(webRequestOf(c)) ?? c.notFound());
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
