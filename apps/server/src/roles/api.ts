import { randomUUID } from "node:crypto";
import process from "node:process";
import { serve } from "@hono/node-server";
import {
  allowEverything,
  type Clock,
  discardUsage,
  type Entitlements,
  type GitHost,
  type GitHostDirectory,
  type GitHostEventSource,
  type GitHostLogin,
  type IndexLimits,
  type UsageSink,
} from "@skillcdn/core";
import { createBlobStore, createDatabase, type Database } from "@skillcdn/db";
import {
  connectGitHub,
  createGitHubEvents,
  createGitHubHost,
  createGitHubLogin,
  type GitHubHostOptions,
} from "@skillcdn/github";
import type { Hono } from "hono";
import { systemClock } from "../adapters/system-clock.js";
import { UserCredentials } from "../auth/credentials.js";
import { LOGIN_HOST, Login } from "../auth/login.js";
import { AuthorizationServer } from "../auth/oauth/authorization-server.js";
import { OAuthClients } from "../auth/oauth/clients.js";
import { type DocumentFetcher, fetchPublicDocument } from "../auth/oauth/document-fetch.js";
import { Permissions } from "../auth/permissions.js";
import { RepoTokens } from "../auth/repo-tokens.js";
import { createSecrets } from "../auth/secrets.js";
import { Sessions } from "../auth/sessions.js";
import { type AuthConfig, type Config, ConfigError } from "../config/config.js";
import { HostEvents } from "../events/host-events.js";
import { type AppAuth, createApp } from "../http/app.js";
import { createClientAddressResolver } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import { loadWebBundle, type WebBundle, WebBundleError } from "../http/web.js";
import { SnapshotService } from "../indexer/snapshot-service.js";
import { Janitor } from "../janitor.js";
import type { Logger } from "../logger.js";
import { MountReader } from "../mounts/mount-reader.js";
import { MountService } from "../mounts/mount-service.js";
import { createOperatorEntitlements } from "../operator/entitlements.js";
import { OperatorImages } from "../operator/images.js";
import { LegalDocuments } from "../operator/legal.js";
import { OperatorLists } from "../operator/lists.js";
import { Showcase } from "../operator/showcase.js";
import { OwnerService } from "../owners/owner-service.js";
import { SocialCards } from "../social/cards.js";
import { PictureFetcher } from "../social/pictures.js";
import { noUsageStats, UsageRecorder, type UsageStats } from "../stats/usage-recorder.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

/** How much older than its TTL a cached fact may be when the git host cannot be asked. */
const STALE_GRACE_FACTOR = 10;
/** How often what time has ended is removed from the tables that hold it. */
const JANITOR_INTERVAL_MS = 15 * 60_000;

export interface ApiPorts {
  readonly database: Database;
  readonly gitHost: GitHost;
  /** Who the accounts of the git host are, for their pages. Left out, there are no such pages. */
  readonly directory?: GitHostDirectory | undefined;
  /** How people sign in through the git host. Needed, with `auth` configured, for anyone to. */
  readonly login?: GitHostLogin | undefined;
  /**
   * What reads the git host's deliveries. Given, the deployment receives the host's events and
   * ends what it remembers when they say so; left out, there is no such route.
   */
  readonly events?: GitHostEventSource | undefined;
  /**
   * How a client's metadata document is fetched; from the public internet when left out. Tests
   * hand in one that never leaves the process.
   */
  readonly fetchClientDocument?: DocumentFetcher | undefined;
  readonly clock: Clock;
  readonly entitlements: Entitlements;
  readonly usage: UsageSink;
  readonly logger: Logger;
  readonly isShuttingDown: () => boolean;
  /** A loaded build of the web UI. Left out, the server is MCP and REST only. */
  readonly web?: WebBundle | undefined;
  /** Left out, nothing is counted. */
  readonly stats?: UsageStats | undefined;
  /**
   * How the pictures of social previews are fetched from the git host (ADR-0032); the
   * platform's own fetch when left out. Tests hand in one that never leaves the process.
   */
  readonly fetch?: ((input: string, init: RequestInit) => Promise<Response>) | undefined;
}

export type ApiConfig = Pick<Config, "mounts" | "indexing"> & {
  readonly web?: { readonly publicUrl?: string | undefined };
  /** Left out, nobody signs in. What it needs of the git host arrives through the ports. */
  readonly auth?:
    | (Omit<AuthConfig, "github"> & {
        /** In place of the built-in bound on clients nobody has used; for tests. */
        readonly maxUnusedClients?: number;
      })
    | undefined;
  /** Left out, there is no admin API. */
  readonly admin?: Config["admin"];
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
): {
  readonly app: Hono<AppEnv>;
  readonly snapshots: SnapshotService;
  readonly lists: OperatorLists;
  readonly showcase: Showcase;
  readonly images: OperatorImages;
  readonly legal: LegalDocuments;
  /** What signing in is made of, when people can. */
  readonly auth: AppAuth | undefined;
} {
  const { database, gitHost, clock, usage, logger } = ports;
  const blobStore = createBlobStore(database);
  const limits: IndexLimits = config.indexing.limits;

  // The operator's deny list decides first; whatever the port was given decides the rest.
  const lists = new OperatorLists({ database, clock });
  const showcase = new Showcase({ database, clock, logger });
  const images = new OperatorImages({ database, clock });
  const legal = new LegalDocuments({ database, clock });
  const entitlements = createOperatorEntitlements(lists, ports.entitlements);

  // People sign in only where the deployment is configured for it and the git host can be
  // asked who they are. Everything that follows from it hangs off this one value: without it
  // there are no sessions, no tokens, and nothing but public repositories.
  let auth: AppAuth | undefined;
  let permissions: Permissions | undefined;
  if (config.auth !== undefined && ports.login !== undefined) {
    const origin = config.web?.publicUrl;
    if (origin === undefined) {
      throw new ConfigError([
        "PUBLIC_URL: required for signing in, which needs one origin to come back to",
      ]);
    }
    const secrets = createSecrets(config.auth.secret);
    const secure = origin.startsWith("https://");
    const credentials = new UserCredentials({
      database,
      login: ports.login,
      secrets,
      clock,
      logger,
    });
    const sessions = new Sessions({
      database,
      clock,
      logger,
      ttlMs: config.auth.sessionTtlMs,
      secure,
    });
    const clients = new OAuthClients({
      database,
      clock,
      logger,
      fetchDocument: ports.fetchClientDocument ?? fetchPublicDocument,
      ...(config.auth.maxUnusedClients === undefined
        ? {}
        : { maxUnusedClients: config.auth.maxUnusedClients }),
    });
    permissions = new Permissions({
      database,
      login: ports.login,
      credentials,
      clock,
      ttlMs: config.auth.permissionTtlMs,
    });
    auth = {
      origin,
      sessions,
      credentials,
      clients,
      tokens: new RepoTokens({ database, clock, logger }),
      hostLogin: ports.login,
      clock,
      login: new Login({
        database,
        login: ports.login,
        credentials,
        sessions,
        secrets,
        clock,
        logger,
        origin,
        secure,
      }),
      authorization: new AuthorizationServer({
        database,
        clients,
        secrets,
        clock,
        logger,
        origin,
        accessTokenTtlMs: config.auth.accessTokenTtlMs,
        refreshTokenTtlMs: config.auth.refreshTokenTtlMs,
      }),
    };
  }

  const mounts = new MountService({
    database,
    gitHost,
    clock,
    entitlements,
    repoTtlMs: config.mounts.repoTtlMs,
    refTtlMs: config.mounts.refTtlMs,
    staleGraceMs: Math.max(config.mounts.repoTtlMs, config.mounts.refTtlMs) * STALE_GRACE_FACTOR,
    isVerified: (key) => lists.isVerified(key),
    imageOf: (address) => images.imageFor(address),
    permissions,
  });
  const owners =
    ports.directory === undefined
      ? undefined
      : new OwnerService({
          database,
          directory: ports.directory,
          lists,
          images,
          clock,
          ttlMs: config.mounts.repoTtlMs,
          isPublic: (coordinates) => mounts.isPublic(coordinates),
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
    newLeaseOwner: randomUUID,
  });

  const reader = new MountReader({ database, blobStore, gitHost, snapshots, limits });
  // The owner's picture, fetched once for the icon of an address's server and for its social
  // preview alike.
  const pictures = new PictureFetcher({
    fetch: ports.fetch ?? ((input, init) => fetch(input, init)),
    clock,
  });
  // Social previews are pages' business: without a web build there is nothing to draw them for.
  const social =
    ports.web === undefined
      ? undefined
      : new SocialCards({ pictures, clock, logger, fonts: ports.web.fonts });

  const app = createApp({
    database,
    auth,
    webhooks:
      ports.events === undefined
        ? undefined
        : {
            source: ports.events,
            events: new HostEvents({
              database,
              clock,
              host: ports.events.host,
              repoTtlMs: config.mounts.repoTtlMs,
              refTtlMs: config.mounts.refTtlMs,
            }),
          },
    owners,
    mounts,
    snapshots,
    reader,
    lists,
    showcase,
    images,
    legal,
    admin: config.admin?.token === undefined ? undefined : { token: config.admin.token },
    web: ports.web,
    social,
    pictures,
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
      reader,
      usage,
      stats: ports.stats ?? noUsageStats,
      clock,
      logger,
      indexWaitMs: config.indexing.waitMs,
      publicUrl: config.web?.publicUrl,
    },
  });
  return { app, snapshots, lists, showcase, images, legal, auth };
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
  let web: WebBundle | undefined;
  if (config.web.root !== undefined) {
    try {
      web = await loadWebBundle(config.web.root, {
        publicUrl: config.web.publicUrl,
        // The pages offer signing in where the deployment is configured for it.
        tags: { ...config.web.tags, signIn: config.auth === undefined ? undefined : LOGIN_HOST },
      });
    } catch (error) {
      if (error instanceof WebBundleError) {
        // A setting that points at the wrong place, not a failure of the process.
        throw new ConfigError([`WEB_ROOT: ${error.message}`]);
      }
      throw error;
    }
    logger.info(
      {
        publicUrl: config.web.publicUrl ?? "(per request)",
        analytics: config.web.tags.googleAnalyticsId !== undefined,
      },
      "serving the web UI",
    );
  }

  if (config.auth !== undefined && web === undefined) {
    // Signing in and agreeing to a client happen on pages; without them a person has nowhere
    // to do either, and a client would be sent to a page that is not there.
    throw new ConfigError(["WEB_ROOT: required for signing in, which happens on the web UI"]);
  }

  const recorder = config.stats.enabled
    ? new UsageRecorder({ database, clock: systemClock, logger, secret: config.stats.hashSecret })
    : undefined;
  recorder?.start(config.stats.flushMs);

  // One connection to the git host for everything: reading repositories, as the deployment or
  // through the app's installations, and signing people in through the same app.
  const github: GitHubHostOptions = {
    baseUrl: config.github.apiUrl,
    userAgent: `${SERVER_NAME}/${SERVER_VERSION}`,
    token: async () => config.github.token,
    ...(config.auth === undefined
      ? {}
      : {
          app: { appId: config.auth.github.appId, privateKey: config.auth.github.privateKey },
        }),
  };
  const connection = connectGitHub(github);
  const gitHost = createGitHubHost(github, connection);
  const login =
    config.auth === undefined
      ? undefined
      : createGitHubLogin(
          {
            ...github,
            clientId: config.auth.github.clientId,
            clientSecret: config.auth.github.clientSecret,
            ...(config.auth.github.webUrl === undefined
              ? {}
              : { webUrl: config.auth.github.webUrl }),
          },
          connection,
        );
  const janitor = new Janitor({ database, clock: systemClock, logger });
  janitor.start(JANITOR_INTERVAL_MS);

  let shuttingDown = false;
  const { app, snapshots } = createApi(config, {
    web,
    stats: recorder,
    database,
    gitHost,
    directory: gitHost,
    login,
    events:
      config.auth?.github.webhookSecret === undefined
        ? undefined
        : createGitHubEvents({ secret: config.auth.github.webhookSecret }),
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
  await recorder?.close();
  await janitor.close();
  await database.close();
  logger.info("shutdown complete");
}
