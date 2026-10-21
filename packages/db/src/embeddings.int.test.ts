import {
  type HostRepository,
  type IndexEntry,
  NO_LICENSE,
  SECTIONING_VERSION,
} from "@skillcdn/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addEmbeddingUsage,
  blobsWithoutVectors,
  claimSnapshot,
  type Database,
  deleteEmbeddingsOutsideKey,
  embeddedBytesOfRepository,
  ensureSnapshot,
  getEmbeddingUsage,
  getRepo,
  getSnapshotEmbedding,
  listSnapshotsToEmbed,
  recordSnapshotEmbedding,
  type SectionVector,
  type SnapshotScope,
  saveCachedRef,
  saveRepository,
  supportsSectionVectors,
  type VectorKey,
  writeSectionVectors,
  writeSnapshotIndex,
} from "./index.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

// How far each snapshot has been embedded (ADR-0064): the worker's record of its slices, the
// list of what is served and still to embed under the configured key, and what goes with a
// replaced model.

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-01-01T01:00:00Z");
const T2 = new Date("2026-01-01T02:00:00Z");
const KEY: VectorKey = { model: "model-one", dimensions: 4, sectioningVersion: SECTIONING_VERSION };
const OLD_KEY: VectorKey = { ...KEY, model: "model-zero" };

let nextHostId = 7000;
function hostRepository(visibility: "public" | "private" = "public"): HostRepository {
  nextHostId += 1;
  return {
    hostRepoId: String(nextHostId),
    name: "Docs",
    defaultBranch: "main",
    description: undefined,
    visibility,
    owner: { hostAccountId: `9${nextHostId}`, login: "Acme", kind: "organization" },
  };
}

const ENTRIES: IndexEntry[] = [
  {
    path: "docs/a.md",
    kind: "markdown",
    size: 10,
    blobSha: "blob-a",
    skillDir: undefined,
    name: undefined,
    title: "A",
    description: undefined,
    frontMatter: undefined,
    searchable: true,
    visible: true,
  },
];

interface Made {
  readonly scope: SnapshotScope;
  readonly repo: { readonly accountId: string; readonly repoId: string };
  readonly commit: string;
}

/** A ready snapshot of a repository of its own, the commit of its default branch when `served`. */
async function readySnapshot(options: {
  readonly served: boolean;
  readonly indexedAt?: Date;
  readonly ready?: boolean;
  readonly visibility?: "public" | "private";
}): Promise<Made> {
  const alias = { host: "gh" as const, owner: `owner${nextHostId}`, repo: "docs" };
  const saved = await saveRepository(database, alias, hostRepository(options.visibility), T0);
  const repo = { accountId: saved.accountId, repoId: saved.id };
  const commit = nextHostId.toString(16).padStart(40, "0");
  const snapshot = await ensureSnapshot(database, repo, commit, 1, T0);
  const scope: SnapshotScope = { accountId: repo.accountId, snapshotId: snapshot.id };
  if (options.ready !== false) {
    expect(await claimSnapshot(database, scope, "builder", T0, 60_000)).toBeDefined();
    expect(
      await writeSnapshotIndex(
        database,
        scope,
        "builder",
        {
          entries: ENTRIES,
          truncated: false,
          indexedBytes: 0,
          diagnostics: [],
          license: NO_LICENSE,
          version: 1,
        },
        options.indexedAt ?? T0,
      ),
    ).toBe(true);
  }
  if (options.served) {
    await saveCachedRef(database, repo, "", commit, T0);
  }
  return { scope, repo, commit };
}

const progress = (
  bodies: number,
  sections: number,
  tokens: number,
  completed: boolean,
  bytes = sections * 100,
) => ({
  bodies,
  sections,
  tokens,
  bytes,
  completed,
});

describe("snapshot embeddings", () => {
  it("add up the slices of a snapshot and mark it complete once", async () => {
    const { scope } = await readySnapshot({ served: true });
    expect(await getSnapshotEmbedding(database, scope, KEY)).toBeUndefined();

    await recordSnapshotEmbedding(database, scope, KEY, progress(1, 2, 10, false), T0);
    expect(await getSnapshotEmbedding(database, scope, KEY)).toMatchObject({
      snapshotId: scope.snapshotId,
      model: KEY.model,
      bodies: 1,
      sections: 2,
      tokens: 10,
      completedAt: null,
      updatedAt: T0,
    });

    await recordSnapshotEmbedding(database, scope, KEY, progress(1, 3, 5, true), T1);
    expect(await getSnapshotEmbedding(database, scope, KEY)).toMatchObject({
      bodies: 2,
      sections: 5,
      tokens: 15,
      bytes: 500,
      completedAt: T1,
      updatedAt: T1,
    });

    // A later slice over a complete snapshot adds its counts and leaves the mark where it was.
    await recordSnapshotEmbedding(database, scope, KEY, progress(0, 0, 0, false), T2);
    expect(await getSnapshotEmbedding(database, scope, KEY)).toMatchObject({
      bodies: 2,
      completedAt: T1,
      updatedAt: T2,
    });
    // Another key is another record.
    expect(await getSnapshotEmbedding(database, scope, OLD_KEY)).toBeUndefined();
  });

  it("list the served snapshots that have no complete embedding under the key, newest index first", async () => {
    const unembedded = await readySnapshot({ served: true, indexedAt: T1 });
    const complete = await readySnapshot({ served: true });
    await recordSnapshotEmbedding(database, complete.scope, KEY, progress(1, 1, 1, true), T0);
    const halfway = await readySnapshot({ served: true, indexedAt: T2 });
    await recordSnapshotEmbedding(database, halfway.scope, KEY, progress(1, 1, 1, false), T0);
    const underOldKey = await readySnapshot({ served: true, indexedAt: T0 });
    await recordSnapshotEmbedding(
      database,
      underOldKey.scope,
      OLD_KEY,
      progress(1, 1, 1, true),
      T0,
    );
    const unserved = await readySnapshot({ served: false });
    const pending = await readySnapshot({ served: true, ready: false });

    const listed = await listSnapshotsToEmbed(database, KEY, 100);
    const ids = listed.map((item) => item.snapshotId);
    expect(ids).toContain(unembedded.scope.snapshotId);
    expect(ids).toContain(halfway.scope.snapshotId);
    expect(ids).toContain(underOldKey.scope.snapshotId);
    expect(ids).not.toContain(complete.scope.snapshotId);
    expect(ids).not.toContain(unserved.scope.snapshotId);
    expect(ids).not.toContain(pending.scope.snapshotId);
    // Newest index first, as the backfill is worth the most where the pack moves.
    expect(ids.indexOf(halfway.scope.snapshotId)).toBeLessThan(
      ids.indexOf(unembedded.scope.snapshotId),
    );
    expect(ids.indexOf(unembedded.scope.snapshotId)).toBeLessThan(
      ids.indexOf(underOldKey.scope.snapshotId),
    );
    expect(listed.find((item) => item.snapshotId === unembedded.scope.snapshotId)).toEqual({
      accountId: unembedded.repo.accountId,
      repoId: unembedded.repo.repoId,
      snapshotId: unembedded.scope.snapshotId,
      commitSha: unembedded.commit,
    });
    expect(await listSnapshotsToEmbed(database, KEY, 1)).toHaveLength(1);
  });

  it("leave the snapshots of private repositories out when asked for public ones", async () => {
    const open = await readySnapshot({ served: true });
    const closed = await readySnapshot({ served: true, visibility: "private" });
    const ids = (await listSnapshotsToEmbed(database, KEY, 100, { visibility: "public" })).map(
      (item) => item.snapshotId,
    );
    expect(ids).toContain(open.scope.snapshotId);
    expect(ids).not.toContain(closed.scope.snapshotId);
    const all = (await listSnapshotsToEmbed(database, KEY, 100)).map((item) => item.snapshotId);
    expect(all).toContain(closed.scope.snapshotId);
    expect(await getRepo(database, closed.repo)).toMatchObject({
      id: closed.repo.repoId,
      accountId: closed.repo.accountId,
      host: "gh",
      repository: { visibility: "private", owner: { login: "Acme", kind: "organization" } },
    });
    expect(
      await getRepo(database, { accountId: open.repo.accountId, repoId: closed.repo.repoId }),
    ).toBeUndefined();
  });

  it("add up the bytes of a repository over its snapshots, and of an account over a day", async () => {
    const first = await readySnapshot({ served: true });
    // A second snapshot of the same repository, under another commit.
    const second = await ensureSnapshot(database, first.repo, "b".repeat(40), 1, T0);
    const secondScope = { accountId: first.repo.accountId, snapshotId: second.id };
    await recordSnapshotEmbedding(database, first.scope, KEY, progress(2, 4, 40, true, 1000), T0);
    await recordSnapshotEmbedding(database, secondScope, KEY, progress(1, 1, 10, true, 250), T0);
    await recordSnapshotEmbedding(
      database,
      first.scope,
      OLD_KEY,
      progress(1, 1, 1, true, 9999),
      T0,
    );
    expect(await embeddedBytesOfRepository(database, first.repo, KEY)).toBe(1250);
    const other = await readySnapshot({ served: true });
    expect(await embeddedBytesOfRepository(database, other.repo, KEY)).toBe(0);

    const account = first.repo.accountId;
    expect(await getEmbeddingUsage(database, account, "2026-01-01")).toBeUndefined();
    await addEmbeddingUsage(
      database,
      account,
      "2026-01-01",
      { bytes: 1000, sections: 4, tokens: 40 },
      T0,
    );
    await addEmbeddingUsage(
      database,
      account,
      "2026-01-01",
      { bytes: 250, sections: 1, tokens: 10 },
      T1,
    );
    await addEmbeddingUsage(
      database,
      account,
      "2026-01-02",
      { bytes: 5, sections: 1, tokens: 1 },
      T2,
    );
    expect(await getEmbeddingUsage(database, account, "2026-01-01")).toEqual({
      bytes: 1250,
      sections: 5,
      tokens: 50,
    });
    expect(await getEmbeddingUsage(database, account, "2026-01-02")).toEqual({
      bytes: 5,
      sections: 1,
      tokens: 1,
    });
  });

  it("are forgotten when the snapshot's index is written again", async () => {
    const { scope, repo, commit } = await readySnapshot({ served: true });
    await recordSnapshotEmbedding(database, scope, KEY, progress(1, 1, 1, true), T0);
    // The reading rules moved on: the ready index goes back to pending and is built again.
    const again = await ensureSnapshot(database, repo, commit, 2, T1);
    expect(again.status).toBe("pending");
    expect(await claimSnapshot(database, scope, "rebuilder", T1, 60_000)).toBeDefined();
    expect(
      await writeSnapshotIndex(
        database,
        scope,
        "rebuilder",
        {
          entries: ENTRIES,
          truncated: false,
          indexedBytes: 0,
          diagnostics: [],
          license: NO_LICENSE,
          version: 2,
        },
        T1,
      ),
    ).toBe(true);
    expect(await getSnapshotEmbedding(database, scope, KEY)).toBeUndefined();
    expect(
      (await listSnapshotsToEmbed(database, KEY, 100)).map((item) => item.snapshotId),
    ).toContain(scope.snapshotId);
  });

  it("drop the vectors and the records of every other key, and keep the key's", async () => {
    expect(await supportsSectionVectors(database)).toBe(true);
    const { scope } = await readySnapshot({ served: true });
    const vector = (blobSha: string, numbers: number[]): SectionVector => ({
      blobSha,
      section: 0,
      heading: [],
      offset: 0,
      length: 5,
      vector: Float32Array.from(numbers),
    });
    await writeSectionVectors(database, OLD_KEY, [
      vector("blob-old-1", [1, 0, 0, 0]),
      vector("blob-old-2", [0, 1, 0, 0]),
    ]);
    await writeSectionVectors(database, KEY, [vector("blob-old-1", [0, 0, 1, 0])]);
    await recordSnapshotEmbedding(database, scope, OLD_KEY, progress(2, 2, 2, true), T0);
    await recordSnapshotEmbedding(database, scope, KEY, progress(1, 1, 1, true), T0);

    // The records under the old key: this snapshot's, and the ones earlier tests left.
    const removed = await deleteEmbeddingsOutsideKey(database, KEY);
    expect(removed.vectors).toBe(2);
    expect(removed.snapshots).toBeGreaterThanOrEqual(1);
    expect(await blobsWithoutVectors(database, KEY, ["blob-old-1"])).toEqual(new Set());
    expect(await blobsWithoutVectors(database, OLD_KEY, ["blob-old-1", "blob-old-2"])).toEqual(
      new Set(["blob-old-1", "blob-old-2"]),
    );
    expect(await getSnapshotEmbedding(database, scope, KEY)).toMatchObject({ bodies: 1 });
    expect(await getSnapshotEmbedding(database, scope, OLD_KEY)).toBeUndefined();
    // Nothing left of other keys: nothing more goes.
    expect(await deleteEmbeddingsOutsideKey(database, KEY)).toEqual({ vectors: 0, snapshots: 0 });
  });
});
