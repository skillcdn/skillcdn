import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  type Address,
  allowEverything,
  type Entitlements,
  parseAddress,
  type UsageEvent,
} from "@skillcdn/core";
import type { TestDatabase } from "@skillcdn/db/testing";
import type { Hono } from "hono";
import { pino } from "pino";
import { parseCidr } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import type { WebBundle } from "../http/web.js";
import type { SnapshotService } from "../indexer/snapshot-service.js";
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
  readonly usage: UsageEvent[];
  connect(address: string): Promise<Client>;
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface HarnessOptions {
  readonly indexWaitMs?: number;
  readonly entitlements?: Entitlements;
  readonly host?: FixtureHost;
  readonly trustedProxies?: readonly string[];
  readonly clientIpHeader?: string;
  /** Addresses for the front page of the explorer, as they are written in configuration. */
  readonly featured?: readonly string[];
  /** A loaded web build. Left out, the server has no UI. */
  readonly web?: WebBundle;
  /** Left out, nothing is counted. */
  readonly stats?: UsageStats;
}

function addressOf(text: string): Address {
  const parsed = parseAddress(text);
  if (!parsed.ok) {
    throw new Error(`not an address: ${text}`);
  }
  return parsed.value;
}

export function createHarness(testDatabase: TestDatabase, options: HarnessOptions = {}): Harness {
  const host = options.host ?? createFixtureHost();
  const usage: UsageEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const { app, snapshots } = createApi(
    {
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
      http: {
        trustedProxies: (options.trustedProxies ?? []).flatMap((text) => parseCidr(text) ?? []),
        clientIpHeader: options.clientIpHeader ?? "x-forwarded-for",
        requestIdHeader: "x-request-id",
        accessLog: true,
      },
      web: { featured: (options.featured ?? []).map(addressOf) },
      indexing: {
        waitMs: options.indexWaitMs ?? 10_000,
        concurrency: 2,
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
    usage,
    request,
    async connect(address) {
      const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${BASE_URL}${address}`), {
          fetch: async (input, init) => app.fetch(new Request(input, init)),
        }),
      );
      return client;
    },
  };
}
