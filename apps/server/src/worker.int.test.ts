import { createHash } from "node:crypto";
import { type Embedder, parseAddress, SECTIONING_VERSION, sectionsOf } from "@skillcdn/core";
import {
  blobsWithoutVectors,
  createBlobStore,
  createJobQueue,
  ensureSnapshot,
  findRepoByAlias,
  getSnapshotEmbedding,
  type JobQueue,
  recordSnapshotEmbedding,
  type SectionVector,
  type SnapshotScope,
  servedEntries,
  type VectorKey,
  writeSectionVectors,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { INDEX_VERSION } from "@skillcdn/indexer";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InferenceError } from "./adapters/inference.js";
import { embedSnapshotSlice } from "./jobs/embed-snapshot.js";
import {
  EMBED_QUEUE,
  ensureJobQueues,
  INDEX_QUEUE,
  type QUEUE_SETTINGS,
  SWEEP_QUEUE,
  sendEmbedJob,
  sendIndexJob,
} from "./jobs/queues.js";
import { sweepEmbeddings } from "./jobs/sweep.js";
import { createWorker, type Worker } from "./jobs/worker.js";
import { createFixtureHost, type FixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";

// The worker role (ADR-0064, point 3) against the fixture git host and an embedder that answers
// in the process: a repository indexed on request and then embedded ahead of the rest, the
// sections of a snapshot embedded body by body in slices that take turns on the queue, a slice
// tried again after the embedder failed without embedding a body twice, the sweep that queues
// what is served and not yet embedded and drops a replaced model's vectors once it is, and the
// api queueing the embedding of the commits it indexes.

const DIMENSIONS = 8;
const KEY: VectorKey = {
  model: "fake-embedding",
  dimensions: DIMENSIONS,
  sectioningVersion: SECTIONING_VERSION,
};
const OLD_KEY: VectorKey = { ...KEY, model: "older-embedding" };
/** Quick retries, so that a test sees the second attempt within seconds. */
const TEST_SETTINGS = {
  [EMBED_QUEUE]: { retryLimit: 3, retryDelaySeconds: 1, expireInSeconds: 60 },
  [INDEX_QUEUE]: { retryLimit: 3, retryDelaySeconds: 1, expireInSeconds: 60 },
  [SWEEP_QUEUE]: { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 },
} satisfies typeof QUEUE_SETTINGS;

/** A unit vector made of the text, the same for the same text. */
function vectorOf(text: string): Float32Array {
  const digest = createHash("sha256").update(text).digest();
  const vector = Float32Array.from({ length: DIMENSIONS }, (_, at) => (digest[at] ?? 0) - 128);
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

/** An embedder in the process: remembers every call, and fails the next one when told to. */
function fakeEmbedder(maxTexts: number) {
  const calls: string[][] = [];
  let failNext: Error | undefined;
  const embedder: Embedder = {
    model: KEY.model,
    dimensions: DIMENSIONS,
    maxTexts,
    maxTextChars: 8000,
    maxBatchChars: 32_000,
    async embed(texts) {
      if (failNext !== undefined) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      if (texts.length > maxTexts) {
        throw new Error(`${texts.length} texts in one call`);
      }
      calls.push([...texts]);
      return {
        vectors: texts.map(vectorOf),
        tokens: texts.reduce((sum, text) => sum + text.length, 0),
      };
    },
  };
  return {
    embedder,
    calls,
    fail(error: Error) {
      failNext = error;
    },
  };
}

let testDatabase: TestDatabase;
let jobs: JobQueue;
let host: FixtureHost;
let worker: Worker;
const fake = fakeEmbedder(4);
const logs: Record<string, unknown>[] = [];
const logger = pino(
  { level: "info" },
  { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
);
const clock = { now: () => new Date() };
const queueErrors: Error[] = [];

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  host = createFixtureHost();
  jobs = await createJobQueue(testDatabase.database, {
    role: "worker",
    onError: (error) => queueErrors.push(error),
  });
  worker = createWorker(
    {
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
      indexing: {
        waitMs: 10_000,
        concurrency: 2,
        leaseMs: 60_000,
        limits: {
          maxTreeEntries: 1000,
          maxIndexedFiles: 100,
          maxIndexedFileBytes: 262_144,
          maxIndexedTotalBytes: 1_048_576,
          maxReadableFileBytes: 262_144,
          maxArchiveBytes: 10_000_000,
        },
      },
      embedConcurrency: 1,
    },
    {
      database: testDatabase.database,
      jobs,
      gitHost: host,
      embedder: fake.embedder,
      clock,
      logger,
      pollSeconds: 0.5,
      sliceSections: 40,
    },
  );
  const started = await worker.start();
  expect(started.queues).toEqual([INDEX_QUEUE, EMBED_QUEUE, SWEEP_QUEUE]);
  await ensureJobQueues(jobs, TEST_SETTINGS);
});

afterAll(async () => {
  await worker?.close(5000);
  await testDatabase?.drop();
});

/** The snapshot of the default branch of a fixture repository, once the worker has indexed it. */
async function snapshotOf(repo: string): Promise<SnapshotScope & { readonly repoId: string }> {
  const known = await findRepoByAlias(testDatabase.database, { host: "gh", owner: "acme", repo });
  if (known === undefined) throw new Error(`${repo} was not resolved`);
  const snapshot = await ensureSnapshot(
    testDatabase.database,
    { accountId: known.accountId, repoId: known.id },
    fixtureCommits().main,
    INDEX_VERSION,
    new Date(),
  );
  return { accountId: known.accountId, snapshotId: snapshot.id, repoId: known.id };
}

/** What the worker is expected to embed of a snapshot: its searchable Markdown bodies, each once. */
async function expectedOf(scope: SnapshotScope) {
  const entries = (await servedEntries(testDatabase.database, scope)).filter(
    (entry) => entry.searchable && (entry.kind === "markdown" || entry.kind === "skill"),
  );
  const blobs = createBlobStore(testDatabase.database);
  const bodies = new Map<string, number>();
  for (const entry of entries) {
    if (!bodies.has(entry.blobSha)) {
      const text = await blobs.read(entry.blobSha);
      bodies.set(entry.blobSha, text === undefined ? 0 : sectionsOf(text).length);
    }
  }
  return {
    blobs: [...bodies.keys()],
    bodies: [...bodies.values()].filter((count) => count > 0).length,
    sections: [...bodies.values()].reduce((sum, count) => sum + count, 0),
  };
}

const completed = async (scope: SnapshotScope, key: VectorKey = KEY) =>
  vi.waitFor(
    async () => {
      const record = await getSnapshotEmbedding(testDatabase.database, scope, key);
      expect(record?.completedAt).toBeInstanceOf(Date);
      return record;
    },
    { timeout: 25_000, interval: 250 },
  );

describe("the worker", () => {
  it("indexes a repository on request, then embeds every section of its documents, a body once, in slices", async () => {
    expect(await sendIndexJob(jobs, { address: "/gh/acme/document-pack" })).toBe(true);
    // The same request again is not queued twice.
    expect(await sendIndexJob(jobs, { address: "/gh/acme/document-pack" })).toBe(false);

    await vi.waitFor(
      async () =>
        expect(
          await findRepoByAlias(testDatabase.database, {
            host: "gh",
            owner: "acme",
            repo: "document-pack",
          }),
        ).toBeDefined(),
      { timeout: 20_000 },
    );
    const scope = await snapshotOf("document-pack");
    const record = await completed(scope);
    const expected = await expectedOf(scope);
    expect(expected.sections).toBeGreaterThan(40);
    expect(record).toMatchObject({ bodies: expected.bodies, sections: expected.sections });
    expect(record?.tokens).toBeGreaterThan(0);
    expect(await blobsWithoutVectors(testDatabase.database, KEY, expected.blobs)).toEqual(
      new Set(),
    );

    // More than one slice ran, each a job of its own, and every call stayed within the embedder's take.
    const slices = logs.filter(
      (line) => line.msg === "embedding slice done" && line.snapshot === scope.snapshotId,
    );
    expect(slices.length).toBeGreaterThan(1);
    expect(slices.filter((line) => line.next !== undefined)).toHaveLength(slices.length - 1);
    expect(fake.calls.every((call) => call.length <= 4)).toBe(true);
    // A section is embedded as its title, its heading path and its body.
    const texts = fake.calls.flat();
    expect(texts.some((text) => text.startsWith("Invoicing > Late fees: "))).toBe(true);
    // Every body once: no text was embedded twice.
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("tries a slice again after the embedder failed, and embeds no body twice", async () => {
    fake.fail(new InferenceError("inference_unreachable", "the server is away"));
    const before = fake.calls.length;
    await worker.snapshots.ready(await resolveMount("/gh/acme/single-skill"), 20_000);
    const scope = await snapshotOf("single-skill");
    expect(
      await sendEmbedJob(jobs, {
        ...scope,
        commitSha: fixtureCommits().main,
        key: KEY,
        reason: "indexed",
      }),
    ).toBe(true);
    const record = await completed(scope);
    const expected = await expectedOf(scope);
    expect(record).toMatchObject({ bodies: expected.bodies, sections: expected.sections });
    const texts = fake.calls.slice(before).flat();
    expect(new Set(texts).size).toBe(texts.length);
    expect(logs.some((line) => line.msg === "a job failed" && line.attempt === 0)).toBe(true);
  });

  it("skips a job for another model, and one whose snapshot is not ready", async () => {
    const scope = await snapshotOf("single-skill");
    const blobs = createBlobStore(testDatabase.database);
    const deps = { database: testDatabase.database, blobs, embedder: fake.embedder, clock, logger };
    const job = {
      ...scope,
      commitSha: fixtureCommits().main,
      key: KEY,
      reason: "backfill" as const,
    };
    expect(await embedSnapshotSlice(deps, { ...job, key: OLD_KEY })).toEqual({
      status: "skipped",
      reason: "other_key",
    });
    expect(await embedSnapshotSlice(deps, { ...job, commitSha: "f".repeat(40) })).toEqual({
      status: "skipped",
      reason: "another_commit",
    });
    expect(
      await embedSnapshotSlice(deps, {
        ...job,
        snapshotId: "00000000-0000-7000-8000-000000000000",
      }),
    ).toEqual({ status: "skipped", reason: "not_ready" });
    // Nothing more was embedded for any of them.
    const done = await embedSnapshotSlice(deps, job);
    expect(done).toMatchObject({ status: "embedded", bodies: 0, sections: 0, next: undefined });
  });

  it("sweeps what is served and not yet embedded under the key, and drops another model's vectors once nothing is left", async () => {
    // A snapshot the api indexed without queueing anything: the sweep finds it.
    await worker.snapshots.ready(await resolveMount("/gh/acme/multi-skill"), 20_000);
    const scope = await snapshotOf("multi-skill");
    // And what an earlier model left behind.
    const old: SectionVector = {
      blobSha: "blob-of-an-older-model",
      section: 0,
      heading: [],
      offset: 0,
      length: 1,
      vector: vectorOf("old"),
    };
    await writeSectionVectors(testDatabase.database, OLD_KEY, [old]);
    await recordSnapshotEmbedding(
      testDatabase.database,
      scope,
      OLD_KEY,
      { bodies: 1, sections: 1, tokens: 1, completed: true },
      new Date(),
    );

    const first = await sweepEmbeddings({
      database: testDatabase.database,
      jobs,
      key: KEY,
      logger,
    });
    expect(first).toMatchObject({ pending: 1, queued: 1, dropped: undefined });
    await completed(scope);
    const expected = await expectedOf(scope);
    expect(await blobsWithoutVectors(testDatabase.database, KEY, expected.blobs)).toEqual(
      new Set(),
    );

    const second = await sweepEmbeddings({
      database: testDatabase.database,
      jobs,
      key: KEY,
      logger,
    });
    expect(second).toEqual({ pending: 0, queued: 0, dropped: { vectors: 1, snapshots: 1 } });
    expect(await blobsWithoutVectors(testDatabase.database, OLD_KEY, [old.blobSha])).toEqual(
      new Set([old.blobSha]),
    );
    expect(await getSnapshotEmbedding(testDatabase.database, scope, OLD_KEY)).toBeUndefined();
  });

  it("is sent the embedding of every commit the api indexes", async () => {
    const h = createHarness(testDatabase, {
      host,
      onIndexed: async (_mount, snapshot) => {
        await sendEmbedJob(jobs, { ...snapshot, key: KEY, reason: "indexed" });
      },
    });
    const client = await h.connect("/gh/acme/with-manifest");
    await client.callTool({ name: "browse_repo", arguments: {} });
    await h.snapshots.idle();
    const scope = await snapshotOf("with-manifest");
    const record = await completed(scope);
    const expected = await expectedOf(scope);
    expect(record).toMatchObject({ bodies: expected.bodies, sections: expected.sections });
    await client.close();
  });

  it("reported nothing wrong from the queue", () => {
    expect(queueErrors).toEqual([]);
  });
});

/** A mount of a fixture address, resolved as the worker resolves one. */
async function resolveMount(address: string) {
  const parsed = parseAddress(address);
  if (!parsed.ok) throw new Error(`not an address: ${address}`);
  return worker.mounts.resolve(parsed.value);
}
