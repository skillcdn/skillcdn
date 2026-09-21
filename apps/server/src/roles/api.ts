import { randomUUID } from "node:crypto";
import process from "node:process";
import { serve } from "@hono/node-server";
import {
  allowEverything,
  type Clock,
  discardUsage,
  type Entitlements,
  type GitHost,
  type IndexLimits,
  type UsageSink,
} from "@skillcdn/core";
import { createBlobStore, createDatabase, type Database } from "@skillcdn/db";
import { createGitHubHost } from "@skillcdn/github";
import type { Hono } from "hono";
import { systemClock } from "../adapters/system-clock.js";
import type { Config } from "../config/config.js";
import { createApp } from "../http/app.js";
import { createClientAddressResolver } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { MountService } from "../mounts/mount-service.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

/** How much older than its TTL a cached fact may be when the git host cannot be asked. */
const STALE_GRACE_FACTOR = 10;

export interface ApiPorts {
  readonly database: Database;
  readonly gitHost: GitHost;
  readonly clock: Clock;
  readonly entitlements: Entitlements;
  readonly usage: UsageSink;
  readonly logger: Logger;
  readonly isShuttingDown: () => boolean;
}

export type ApiConfig = Pick<Config, "mounts" | "indexing"> & {
  /** Left out, no proxy is trusted and every request is logged. */
  readonly http?: Pick<
    Config["http"],
    "trustedProxies" | "clientIpHeader" | "requestIdHeader" | "accessLog"
  >;
};

/** Wires the services of the `api` role to their ports. Tests call this with their own ports. */
export function createApi(
  config: ApiConfig,
  ports: ApiPorts,
): { readonly app: Hono<AppEnv>; readonly snapshots: SnapshotService } {
  const { database, gitHost, clock, entitlements, usage, logger } = ports;
  const blobStore = createBlobStore(database);
  const limits: IndexLimits = config.indexing.limits;

  const mounts = new MountService({
    database,
    gitHost,
    clock,
    entitlements,
    repoTtlMs: config.mounts.repoTtlMs,
    refTtlMs: config.mounts.refTtlMs,
    staleGraceMs: Math.max(config.mounts.repoTtlMs, config.mounts.refTtlMs) * STALE_GRACE_FACTOR,
  });
  const snapshots = new SnapshotService({
    database,
    gitHost,
    blobStore,
    clock,
    usage,
    logger,
    limits,
    concurrency: config.indexing.concurrency,
    leaseMs: config.indexing.leaseMs,
  });

  const app = createApp({
    database,
    mounts,
    snapshots,
    logger,
    isShuttingDown: ports.isShuttingDown,
    requests: {
      addresses: createClientAddressResolver({
        trustedProxies: config.http?.trustedProxies ?? [],
        header: config.http?.clientIpHeader ?? "x-forwarded-for",
      }),
      requestIdHeader: config.http?.requestIdHeader ?? "x-request-id",
      accessLog: config.http?.accessLog ?? true,
      newRequestId: randomUUID,
      now: () => performance.now(),
    },
    tools: {
      database,
      blobStore,
      gitHost,
      snapshots,
      usage,
      clock,
      logger,
      limits,
      indexWaitMs: config.indexing.waitMs,
    },
  });
  return { app, snapshots };
}

/**
 * The composition root of the `api` role: builds the dependency graph, serves HTTP, and owns
 * shutdown. Resolves when the process has shut down cleanly.
 */
export async function runApi(config: Config, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    maxConnections: config.database.poolMax,
    applicationName: `${SERVER_NAME}-api`,
  });
  let shuttingDown = false;
  const { app, snapshots } = createApi(config, {
    database,
    gitHost: createGitHubHost({
      baseUrl: config.github.apiUrl,
      userAgent: `${SERVER_NAME}/${SERVER_VERSION}`,
      token: async () => config.github.token,
    }),
    clock: systemClock,
    // Ports with a default implementation. A build that layers its own packages on top of this
    // image replaces them here; nothing else in the codebase knows about plans or billing.
    entitlements: allowEverything,
    usage: discardUsage,
    logger,
    isShuttingDown: () => shuttingDown,
  });

  const server = serve({
    fetch: app.fetch,
    hostname: config.http.host,
    port: config.http.port,
    serverOptions: {
      // A proxy in front reuses idle connections. If this side closes them first, the proxy
      // now and then sends a request into a connection that is already gone.
      keepAliveTimeout: config.http.keepAliveMs,
      requestTimeout: config.http.requestTimeoutMs,
      headersTimeout: Math.min(config.http.requestTimeoutMs, 60_000),
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  logger.info({ host: config.http.host, port: config.http.port }, "api listening");

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info({ signal }, "shutting down");
      // Whatever is still open when the grace period ends is cut off.
      const force = setTimeout(() => {
        logger.warn("grace period over; closing open connections");
        if ("closeAllConnections" in server) {
          server.closeAllConnections();
        }
      }, config.http.shutdownGraceMs);
      force.unref();

      // Stop accepting, let requests in flight finish, hand unfinished indexing back, close.
      server.close(() => {
        clearTimeout(force);
        resolve();
      });
      if ("closeIdleConnections" in server) {
        server.closeIdleConnections();
      }
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  });

  await snapshots.close();
  await database.close();
  logger.info("shutdown complete");
}
