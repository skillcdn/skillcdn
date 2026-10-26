import { createHash } from "node:crypto";
import { type Embedder, SECTIONING_VERSION } from "@skillcdn/core";
import {
  createJobQueue,
  getSnapshotEmbedding,
  type JobQueue,
  type SnapshotScope,
  type VectorKey,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  EMBED_QUEUE,
  type EmbedJob,
  embedJobKey,
  ensureJobQueues,
  INDEX_QUEUE,
  type QUEUE_SETTINGS,
  SWEEP_QUEUE,
  sendEmbedJob,
} from "./jobs/queues.js";
import { sweepEmbeddings } from "./jobs/sweep.js";
import { createWorker, type Worker } from "./jobs/worker.js";
import { OperatorLists } from "./operator/lists.js";
import { createFixtureHost } from "./testing/fixture-host.js";
import { type MadeSnapshotOptions, makeSnapshot } from "./testing/made-snapshot.js";

// A worker that starts while one of the build before still runs, as the rollout contract lets
// the two overlap (ADR-0073): what an older build queued, and what waits since its repository's
// rank changed, is given the priority of its rank before a slice is taken; nothing is queued
// beside a job that waits; and the sweep of the worker that starts runs in its own process, where
// no other worker can take it from the queue and fill the queue in the order of its own build.

const DIMENSIONS = 8;
const KEY: VectorKey = {
  model: "fake-embedding",
  dimensions: DIMENSIONS,
  sectioningVersion: SECTIONING_VERSION,
};
/** The priorities of the build before the ranks (ADR-0064): the reason alone, and no rank. */
const OLDER_PRIORITY = { designated: 3, indexed: 2, backfill: 1 } as const;
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

const embedder: Embedder = {
  model: KEY.model,
  dimensions: DIMENSIONS,
  maxTexts: 4,
  maxTextChars: 8000,
  maxBatchChars: 32_000,
  async embed(texts) {
    return {
      vectors: texts.map(vectorOf),
      tokens: texts.reduce((sum, text) => sum + text.length, 0),
    };
  },
};

let testDatabase: TestDatabase;
let jobs: JobQueue;
let worker: Worker | undefined;
const logs: Record<string, unknown>[] = [];
const logger = pino(
  { level: "info" },
  { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
);
const clock = { now: () => new Date() };
const queueErrors: Error[] = [];

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  jobs = await createJobQueue(testDatabase.database, {
    role: "worker",
    onError: (error) => queueErrors.push(error),
  });
  // The queues as a process of the build before made sure of them.
  await ensureJobQueues(jobs, TEST_SETTINGS);
});

afterAll(async () => {
  if (worker === undefined) {
    await jobs?.stop({ timeoutMs: 2000 });
  } else {
    await worker.close(5000);
  }
  await testDatabase?.drop();
});

const madeSnapshot = (options: MadeSnapshotOptions) => makeSnapshot(testDatabase.database, options);
type Made = Awaited<ReturnType<typeof madeSnapshot>>;

const documentOf = (name: string) => ({ path: `docs/${name}.md`, text: `# ${name}\n\nText.\n` });
const SKILL = {
  path: "skills/one/SKILL.md",
  kind: "skill" as const,
  text: "---\nname: one\ndescription: One.\n---\n\n# One\n\nDo it.\n",
};
const MANIFEST = {
  path: "SKILLCDN.md",
  kind: "manifest" as const,
  text: "---\ndescription: A pack.\n---\n",
  frontMatter: { metadata: {}, warnings: [], documents: ["docs"] },
};

/** A public repository whose default branch points at a snapshot of these files. */
const served = (...files: MadeSnapshotOptions["files"]) =>
  madeSnapshot({ visibility: "public", served: true, files });

const jobOf = (made: Made, reason: EmbedJob["reason"]): EmbedJob => ({
  ...made.scope,
  repoId: made.repo.repoId,
  commitSha: made.commit,
  key: KEY,
  reason,
});

/** Queues a first slice as the build before the ranks did: no rank, and a priority by reason. */
async function queuedByOlderBuild(made: Made, reason: "indexed" | "backfill"): Promise<void> {
  const job = jobOf(made, reason);
  const id = await jobs.send(EMBED_QUEUE, job, {
    priority: OLDER_PRIORITY[reason],
    singletonKey: embedJobKey(job),
  });
  expect(id).toBeDefined();
}

/** The operator vouches for the repository, as the admin API writes it. */
const vouchFor = (made: Made) =>
  new OperatorLists({ database: testDatabase.database, clock }).add(
    "verified",
    `/gh/${made.repository.owner.login}/${made.repository.name}`,
  );

const completed = async (scope: SnapshotScope) =>
  vi.waitFor(
    async () => {
      const record = await getSnapshotEmbedding(testDatabase.database, scope, KEY);
      expect(record?.completedAt).toBeInstanceOf(Date);
    },
    { timeout: 25_000, interval: 250 },
  );

describe("a worker beside one of the build before", () => {
  it("gives what an older build queued, and what waits since its rank changed, the priority of its rank, and queues nothing beside a job that waits", async () => {
    const other = await served(documentOf("other"));
    const skills = await served(SKILL, documentOf("skills"));
    const declared = await served(MANIFEST, documentOf("declared"));
    const listed = await served(documentOf("listed"));
    const promoted = await served(SKILL, documentOf("promoted"));
    await queuedByOlderBuild(other, "backfill");
    await queuedByOlderBuild(skills, "indexed");
    await queuedByOlderBuild(declared, "backfill");
    await queuedByOlderBuild(listed, "backfill");
    // Queued by this build while the repository held skills and nothing more; listed since.
    expect(await sendEmbedJob(jobs, { ...jobOf(promoted, "backfill"), tier: "skills" })).toBe(true);
    await vouchFor(listed);
    await vouchFor(promoted);

    const outcome = await sweepEmbeddings({
      database: testDatabase.database,
      jobs,
      key: KEY,
      scope: "public",
      lists: new OperatorLists({ database: testDatabase.database, clock }),
      logger,
    });
    expect(outcome).toMatchObject({
      pending: 4,
      queued: 0,
      reordered: 4,
      tiers: { listed: 2, declared: 1, skills: 1 },
    });
    // In place, oldest first as they were queued, one job a snapshot; what is no pack is left as
    // it was, for the worker to skip.
    const waiting = await jobs.waiting(EMBED_QUEUE, 100);
    expect(
      waiting.map(({ data, priority }) => {
        const job = data as EmbedJob;
        return [job.snapshotId, job.reason, job.tier, priority];
      }),
    ).toEqual([
      [other.scope.snapshotId, "backfill", undefined, 1],
      [skills.scope.snapshotId, "indexed", "skills", 12],
      [declared.scope.snapshotId, "backfill", "declared", 21],
      [listed.scope.snapshotId, "backfill", "listed", 31],
      [promoted.scope.snapshotId, "backfill", "listed", 31],
    ]);
  });

  it("sweeps in its own process when it starts, before it takes a slice, and embeds the listed pack first", async () => {
    // The build before queued these as it found them, what is no pack first.
    const other = await served(documentOf("other-again"));
    const skills = await served(SKILL, documentOf("skills-again"));
    const listed = await served(documentOf("listed-again"));
    await queuedByOlderBuild(other, "backfill");
    await queuedByOlderBuild(skills, "backfill");
    await queuedByOlderBuild(listed, "backfill");
    await vouchFor(listed);

    // Everything the worker sends goes through here: a worker of the build before, still taking
    // the queues while this one starts, would take any sweep sent to the queue.
    const sent: string[] = [];
    const watched: JobQueue = {
      ...jobs,
      send: (name, data, options) => {
        sent.push(name);
        return jobs.send(name, data, options);
      },
    };
    worker = createWorker(
      {
        mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
        indexing: {
          waitMs: 10_000,
          concurrency: 1,
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
        scope: "public",
      },
      {
        database: testDatabase.database,
        jobs: watched,
        gitHost: createFixtureHost(),
        embedder,
        clock,
        logger,
        pollSeconds: 0.5,
      },
    );
    const started = await worker.start();
    expect(started.queues).toEqual([INDEX_QUEUE, EMBED_QUEUE, SWEEP_QUEUE]);
    expect(sent).not.toContain(SWEEP_QUEUE);
    expect(logs.filter((line) => line.msg === "embeddings swept").at(-1)).toMatchObject({
      queued: 0,
      reordered: 2,
    });

    await completed(listed.scope);
    await completed(skills.scope);
    const embedded = logs
      .filter((line) => line.msg === "embedding slice done" && line.status === "embedded")
      .map((line) => line.snapshot);
    expect(embedded.indexOf(listed.scope.snapshotId)).toBeGreaterThanOrEqual(0);
    expect(embedded.indexOf(listed.scope.snapshotId)).toBeLessThan(
      embedded.indexOf(skills.scope.snapshotId),
    );
    // What is no pack waits for a search: its job from the build before is skipped.
    await vi.waitFor(
      () =>
        expect(
          logs.some(
            (line) =>
              line.msg === "embedding slice done" &&
              line.snapshot === other.scope.snapshotId &&
              line.reason === "unasked",
          ),
        ).toBe(true),
      { timeout: 25_000, interval: 250 },
    );
  });

  it("reported nothing wrong from the queue", () => {
    expect(queueErrors).toEqual([]);
  });
});
