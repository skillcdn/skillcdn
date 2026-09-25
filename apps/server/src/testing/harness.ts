import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { allowEverything, type Entitlements, type UsageEvent } from "@skillcdn/core";
import type { TestDatabase } from "@skillcdn/db/testing";
import type { Hono } from "hono";
import { pino } from "pino";
import { parseCidr } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import type { WebBundle } from "../http/web.js";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { OperatorLists } from "../operator/lists.js";
import { createApi } from "../roles/api.js";
import type { UsageStats } from "../stats/usage-recorder.js";
import { createFixtureHost, type FixtureHost } from "./fixture-host.js";

// Test support: the `api` role wired to a fixture git host and a test database.

export const BASE_URL = "http://skillcdn.test";

export interface Harness {
  readonly app: Hono<AppEnv>;
  readonly host: FixtureHost;
  /** Access-log lines and everything else the server logged, as parsed JSON. */
  readonly logs: Record<string, unknown>[];
  readonly snapshots: SnapshotService;
  /** The operator's lists, for a test to vouch for, feature or block a repository. */
  readonly lists: OperatorLists;
  readonly usage: UsageEvent[];
  /** An MCP client connected to an address, from `peer` (the socket address) when given. */
  connect(address: string, options?: { readonly peer?: string }): Promise<Client>;
  request(path: string, init?: RequestInit): Promise<Response>;
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
}

export function createHarness(testDatabase: TestDatabase, options: HarnessOptions = {}): Harness {
  const host = options.host ?? createFixtureHost();
  const usage: UsageEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const { app, snapshots, lists } = createApi(
    {
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
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
      clock: { now: () => new Date() },
      entitlements: options.entitlements ?? allowEverything,
      usage: { record: (event) => usage.push(event) },
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
      isShuttingDown: () => false,
      web: options.web,
      stats: options.stats,
    },
  );
  const request = async (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${BASE_URL}${path}`, init));
  return {
    app,
    host,
    logs,
    snapshots,
    lists,
    usage,
    request,
    async connect(address, options = {}) {
      const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
      const env =
        options.peer === undefined
          ? undefined
          : { incoming: { socket: { remoteAddress: options.peer } } };
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${BASE_URL}${address}`), {
          fetch: async (input, init) => app.fetch(new Request(input, init), env),
        }),
      );
      return client;
    },
  };
}
