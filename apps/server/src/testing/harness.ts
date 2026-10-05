import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  AUTH_ROUTES,
  allowEverything,
  type Clock,
  type Entitlements,
  type GitHostEventSource,
  type UsageEvent,
} from "@skillcdn/core";
import type { TestDatabase } from "@skillcdn/db/testing";
import type { Hono } from "hono";
import { pino } from "pino";
import type { DocumentFetcher } from "../auth/oauth/document-fetch.js";
import type { AppAuth } from "../http/app.js";
import { parseCidr } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import type { WebBundle } from "../http/web.js";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { OperatorImages } from "../operator/images.js";
import type { LegalDocuments } from "../operator/legal.js";
import type { OperatorLists } from "../operator/lists.js";
import type { Showcase } from "../operator/showcase.js";
import { createApi } from "../roles/api.js";
import type { UsageStats } from "../stats/usage-recorder.js";
import { createFixtureHost, type FixtureHost } from "./fixture-host.js";
import type { FixtureLogin } from "./fixture-login.js";

// Test support: the `api` role wired to a fixture git host and a test database.

export const BASE_URL = "http://skillcdn.test";
/** The origin of a harness where people can sign in: signing in wants one origin, and a secure one. */
export const SIGN_IN_URL = "https://skillcdn.test";

export interface Harness {
  readonly app: Hono<AppEnv>;
  readonly host: FixtureHost;
  /** The origin requests are made to: {@link SIGN_IN_URL} where people can sign in. */
  readonly origin: string;
  /** Access-log lines and everything else the server logged, as parsed JSON. */
  readonly logs: Record<string, unknown>[];
  readonly snapshots: SnapshotService;
  /** The operator's lists, for a test to vouch for, feature or block a repository. */
  readonly lists: OperatorLists;
  /** The landing showcase, for a test to write entries and uploads without the admin API. */
  readonly showcase: Showcase;
  /** The pictures of addresses, for a test to write them without the admin API. */
  readonly images: OperatorImages;
  /** The deployment's own pages, for a test to write them without the admin API. */
  readonly legal: LegalDocuments;
  /** What signing in is made of; `undefined` in a harness without it. */
  readonly auth: AppAuth | undefined;
  readonly usage: UsageEvent[];
  /** An MCP client connected to an address, from `peer` (the socket address) when given. */
  connect(address: string, options?: { readonly peer?: string }): Promise<Client>;
  request(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Signs a person of the fixture login in as their browser would, and answers with the Cookie
   * header that carries the session.
   */
  signIn(person: string): Promise<string>;
}

export interface HarnessOptions {
  readonly indexWaitMs?: number;
  /** Commits indexed at once by this process; 0 leaves indexing to another process. */
  readonly indexConcurrency?: number;
  readonly entitlements?: Entitlements;
  readonly host?: FixtureHost;
  readonly trustedProxies?: readonly string[];
  readonly clientIpHeader?: string;
  /** The admin API's bearer token. Left out, there is no admin API. */
  readonly adminToken?: string;
  /** A loaded web build. Left out, the server has no UI. */
  readonly web?: WebBundle;
  /** Left out, nothing is counted. */
  readonly stats?: UsageStats;
  /** What fetching a picture (a social preview's, an icon) answers; left out, nothing is found. */
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** The git host's side of signing in. Given, people can sign in; left out, nobody can. */
  readonly login?: FixtureLogin;
  /** What reads the git host's deliveries. Given, the harness receives the host's events. */
  readonly events?: GitHostEventSource;
  /** The time everything is told; the system's when left out. */
  readonly clock?: Clock;
  /** How long the git host's answer about what a person can see is believed. */
  readonly permissionTtlMs?: number;
  /** How long facts about a repository name and a moving ref are believed. */
  readonly ttlMs?: number;
  readonly accessTokenTtlMs?: number;
  readonly refreshTokenTtlMs?: number;
  /** What fetching a client's metadata document answers; left out, there is none anywhere. */
  readonly fetchClientDocument?: DocumentFetcher;
  /** How many clients nobody has used may be stored; the built-in bound when left out. */
  readonly maxUnusedClients?: number;
}

/** The session cookie a response set, as a Cookie header would carry it. */
function cookieOf(response: Response, name: string): string {
  const found = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0] ?? "")
    .find((pair) => pair.split("=")[0]?.endsWith(name) === true);
  if (found === undefined) {
    throw new Error(`the response set no ${name} cookie`);
  }
  return found;
}

export function createHarness(testDatabase: TestDatabase, options: HarnessOptions = {}): Harness {
  const host = options.host ?? createFixtureHost();
  const usage: UsageEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const origin = options.login === undefined ? BASE_URL : SIGN_IN_URL;
  const ttlMs = options.ttlMs ?? 60_000;
  const { app, snapshots, lists, showcase, images, legal, auth } = createApi(
    {
      mounts: { repoTtlMs: ttlMs, refTtlMs: ttlMs },
      ...(options.login === undefined
        ? {}
        : {
            web: { publicUrl: origin },
            auth: {
              secret: "a secret for tests, long enough to be one",
              sessionTtlMs: 30 * 86_400_000,
              accessTokenTtlMs: options.accessTokenTtlMs ?? 3_600_000,
              refreshTokenTtlMs: options.refreshTokenTtlMs ?? 30 * 86_400_000,
              permissionTtlMs: options.permissionTtlMs ?? 60_000,
              ...(options.maxUnusedClients === undefined
                ? {}
                : { maxUnusedClients: options.maxUnusedClients }),
            },
          }),
      http: {
        trustedProxies: (options.trustedProxies ?? []).flatMap((text) => parseCidr(text) ?? []),
        clientIpHeader: options.clientIpHeader ?? "x-forwarded-for",
        requestIdHeader: "x-request-id",
        accessLog: true,
      },
      admin: { token: options.adminToken },
      indexing: {
        waitMs: options.indexWaitMs ?? 10_000,
        concurrency: options.indexConcurrency ?? 2,
        leaseMs: 60_000,
        limits: {
          maxTreeEntries: 1000,
          maxIndexedFiles: 100,
          maxIndexedFileBytes: 262_144,
          maxIndexedTotalBytes: 1_048_576,
          maxReadableFileBytes: 4096,
          maxArchiveBytes: 10_000_000,
        },
      },
    },
    {
      database: testDatabase.database,
      gitHost: host,
      directory: host,
      login: options.login,
      events: options.events,
      clock: options.clock ?? { now: () => new Date() },
      entitlements: options.entitlements ?? allowEverything,
      usage: { record: (event) => usage.push(event) },
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
      isShuttingDown: () => false,
      web: options.web,
      stats: options.stats,
      // Tests never leave the process: a picture is found only when a test hands one in, and a
      // client's document only when a test serves one.
      fetch: options.fetch ?? (async () => new Response(null, { status: 404 })),
      fetchClientDocument:
        options.fetchClientDocument ??
        (async () => {
          throw new Error("no such document");
        }),
    },
  );
  const request = async (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${origin}${path}`, init));
  return {
    app,
    host,
    origin,
    logs,
    snapshots,
    lists,
    showcase,
    images,
    legal,
    auth,
    usage,
    request,
    async connect(address, options = {}) {
      const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
      const env =
        options.peer === undefined
          ? undefined
          : { incoming: { socket: { remoteAddress: options.peer } } };
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}${address}`), {
          fetch: async (input, init) => app.fetch(new Request(input, init), env),
        }),
      );
      return client;
    },
    async signIn(person) {
      const { login } = options;
      if (login === undefined) {
        throw new Error("nobody can sign in on this harness");
      }
      const begun = await request(AUTH_ROUTES.login);
      const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
      const done = await request(
        `${AUTH_ROUTES.callback}?code=${login.codeFor(person, state)}&state=${state}`,
        { headers: { cookie: cookieOf(begun, "skillcdn_login") } },
      );
      return cookieOf(done, "skillcdn_session");
    },
  };
}
