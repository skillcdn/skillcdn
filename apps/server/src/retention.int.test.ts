import { parseAddress } from "@skillcdn/core";
import {
  claimSnapshot,
  ensureSnapshot,
  findCachedRef,
  findSnapshotOfCommit,
  getSnapshot,
  type JobQueue,
  pruneSnapshots,
  touchSnapshot,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { INDEX_VERSION } from "@skillcdn/indexer";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pruneIndexes } from "./jobs/prune.js";
import { createWorker, type Worker } from "./jobs/worker.js";
import { createFixtureHost } from "./testing/fixture-host.js";
import { makeSnapshot } from "./testing/made-snapshot.js";

// Which indexes are kept (ADR-0086), against the fixture git host: the commit a ref points at
// and the one it pointed at last stay whatever their age; a commit a ref moved on from, and a
// pinned commit, stay while they are read and go once nobody has read them for the time
// configured, with the bodies nothing else names; an index being built is left alone; and a
// read notes itself, at most once an hour, without the reader waiting.

const DAY_MS = 86_400_000;
const logger = pino({ level: "silent" });
const noQueue: JobQueue = {
  ensureQueue: async () => {},
  send: async () => undefined,
  work: async () => {},
  schedule: async () => {},
  unschedule: async () => {},
  waiting: async () => [],
  reorder: async () => false,
  counts: async () => [],
  failures: async () => [],
  stop: async () => {},
};

let testDatabase: TestDatabase;
const closing: Worker[] = [];

beforeAll(async () => {
  testDatabase = await createTestDatabase(DEV_DATABASE_URL);
});
afterAll(async () => {
  for (const worker of closing) {
    await worker.close(1000);
  }
  await testDatabase?.drop();
});

/** Mounts and indexing over a fixture host of its own, on a clock the test moves. */
function setup(variant: string) {
  // Ahead of the system's time, on which the database stamps a row when it is made.
  let now = Date.now() + 2 * 3_600_000;
  const clock = { now: () => new Date(now) };
  const host = createFixtureHost(variant);
  const worker = createWorker(
    {
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
      indexing: {
        waitMs: 10_000,
        concurrency: 2,
        leaseMs: 60_000,
        ahead: { scope: "none", intervalMs: 900_000, limit: 50 },
        retentionMs: 30 * DAY_MS,
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
      scope: "none",
    },
    {
      database: testDatabase.database,
      jobs: noQueue,
      gitHost: host,
      embedder: undefined,
      clock,
      logger,
    },
  );
  closing.push(worker);
  /** Reads an address as a request does: resolved, indexed, and served. */
  const read = async (text: string) => {
    const address = parseAddress(text);
    if (!address.ok) throw new Error(`not an address: ${text}`);
    const mount = await worker.mounts.resolve(address.value);
    expect((await worker.snapshots.ready(mount, 10_000)).status).toBe("ready");
    const served = await worker.snapshots.serving(mount, 10_000);
    if (served.status !== "ready") throw new Error("nothing was served");
    return {
      repo: { accountId: mount.repo.accountId, repoId: mount.repo.id },
      commit: mount.commit,
      snapshot: { accountId: served.snapshot.accountId, snapshotId: served.snapshot.id },
    };
  };
  return {
    host,
    clock,
    read,
    later(ms: number) {
      now += ms;
    },
  };
}

const stateOf = async (
  repo: { readonly accountId: string; readonly repoId: string },
  commit: string,
) => (await findSnapshotOfCommit(testDatabase.database, repo, commit))?.status;

describe("which indexes are kept", () => {
  it("keeps the commit a ref points at and the one before it, and removes what the ref moved on from once unread", async () => {
    const s = setup("retention-refs");
    const first = await s.read("/gh/acme/single-skill");
    s.host.push();
    s.later(61_000);
    const second = await s.read("/gh/acme/single-skill");
    s.host.push();
    s.later(61_000);
    const third = await s.read("/gh/acme/single-skill");
    expect(new Set([first.commit, second.commit, third.commit]).size).toBe(3);

    // Read within the time: everything stays, the commit no ref points at as well.
    const kept = await pruneIndexes({
      database: testDatabase.database,
      clock: s.clock,
      retentionMs: 30 * DAY_MS,
      logger,
    });
    expect(kept.snapshots).toBe(0);
    expect(await stateOf(first.repo, first.commit)).toBe("ready");

    // A month and a day without a read: the ref's commit and the one before it stay, as what
    // answers and what answers while it cannot; the one two pushes back goes.
    s.later(31 * DAY_MS);
    const removed = await pruneIndexes({
      database: testDatabase.database,
      clock: s.clock,
      retentionMs: 30 * DAY_MS,
      logger,
    });
    expect(removed.snapshots).toBeGreaterThanOrEqual(1);
    expect(await stateOf(first.repo, first.commit)).toBeUndefined();
    expect(await stateOf(second.repo, second.commit)).toBe("ready");
    expect(await stateOf(third.repo, third.commit)).toBe("ready");
    // The files were the same in all three commits: the bodies stay for the two that remain.
    const again = await s.read("/gh/acme/single-skill");
    expect(again.commit).toBe(third.commit);
  });

  it("keeps a pinned commit while it is read, and removes it with what only it named once it is not", async () => {
    const s = setup("retention-pinned");
    const moving = await s.read("/gh/acme/multi-skill");
    // An agent pins the commit while the branch is at it, which confirms it for good.
    const pinnedAddress = `/gh/acme/multi-skill@${moving.commit}`;
    await s.read(pinnedAddress);
    s.host.push();
    s.later(61_000);
    await s.read("/gh/acme/multi-skill");
    s.host.push();
    s.later(61_000);
    await s.read("/gh/acme/multi-skill");
    // The first commit is no ref's any more; the agent pinned to it keeps reading it.
    s.later(29 * DAY_MS);
    const pinned = await s.read(pinnedAddress);
    expect(pinned.commit).toBe(moving.commit);
    // The read is noted without the reader waiting for it.
    await vi.waitFor(async () => {
      const row = await getSnapshot(testDatabase.database, pinned.snapshot);
      expect(row?.readAt.getTime()).toBe(s.clock.now().getTime());
    });
    s.later(2 * DAY_MS);
    await pruneIndexes({
      database: testDatabase.database,
      clock: s.clock,
      retentionMs: 30 * DAY_MS,
      logger,
    });
    expect(await stateOf(moving.repo, moving.commit)).toBe("ready");
    expect(
      await findCachedRef(testDatabase.database, moving.repo, `commit:${moving.commit}`),
    ).toBeDefined();

    // Nobody reads it for the time: it goes, and with it the note that the commit was confirmed.
    s.later(31 * DAY_MS);
    await pruneIndexes({
      database: testDatabase.database,
      clock: s.clock,
      retentionMs: 30 * DAY_MS,
      logger,
    });
    expect(await stateOf(moving.repo, moving.commit)).toBeUndefined();
    expect(
      await findCachedRef(testDatabase.database, moving.repo, `commit:${moving.commit}`),
    ).toBeUndefined();
  });

  it("removes the bodies nothing names any more, and leaves alone an index that is being built", async () => {
    const far = new Date(Date.now() + 400 * DAY_MS);
    // An index no ref points at, with two bodies of its own.
    const orphan = await makeSnapshot(testDatabase.database, {
      visibility: "public",
      files: [
        { path: "README.md", text: "# One\n\nA body of its own.\n" },
        { path: "guide.md", text: "# Two\n\nAnother.\n" },
      ],
    });
    // A commit somebody asked for a moment ago, claimed by a process that is indexing it.
    const building = await makeSnapshot(testDatabase.database, {
      visibility: "public",
      files: [{ path: "README.md", text: "# Three\n" }],
    });
    const commit = "b".repeat(40);
    const claimedAt = new Date();
    const pending = await ensureSnapshot(
      testDatabase.database,
      building.repo,
      commit,
      INDEX_VERSION,
      claimedAt,
    );
    const claimed = { accountId: pending.accountId, snapshotId: pending.id };
    expect(
      await claimSnapshot(testDatabase.database, claimed, "a-worker", claimedAt, 3_600_000),
    ).toBeDefined();

    // As if a year had gone by for the rows, while the claim of a moment ago still holds.
    const removed = await pruneSnapshots(testDatabase.database, {
      now: claimedAt,
      before: far,
      limit: 100,
    });
    expect(removed.snapshots).toBeGreaterThanOrEqual(2);
    expect(removed.blobs).toBeGreaterThanOrEqual(3);
    expect(await getSnapshot(testDatabase.database, orphan.scope)).toBeUndefined();
    expect(await getSnapshot(testDatabase.database, building.scope)).toBeUndefined();
    expect((await getSnapshot(testDatabase.database, claimed))?.status).toBe("indexing");
  });

  it("notes a read at most once in the time it is given", async () => {
    const made = await makeSnapshot(testDatabase.database, {
      visibility: "public",
      served: true,
      files: [{ path: "README.md", text: "# Four\n" }],
    });
    const soon = new Date(Date.now() + 30 * 60_000);
    const later = new Date(Date.now() + 2 * 3_600_000);
    // Made a moment ago, which counts as read then: half an hour on, nothing is written.
    expect(await touchSnapshot(testDatabase.database, made.scope, soon, 3_600_000)).toBe(false);
    expect(await touchSnapshot(testDatabase.database, made.scope, later, 3_600_000)).toBe(true);
    expect(await touchSnapshot(testDatabase.database, made.scope, later, 3_600_000)).toBe(false);
    expect((await getSnapshot(testDatabase.database, made.scope))?.readAt).toEqual(later);
    // A ref points at it: it stays, however long ago it was read.
    await pruneSnapshots(testDatabase.database, {
      now: new Date(),
      before: new Date(Date.now() + 400 * DAY_MS),
      limit: 100,
    });
    expect((await getSnapshot(testDatabase.database, made.scope))?.status).toBe("ready");
  });
});
