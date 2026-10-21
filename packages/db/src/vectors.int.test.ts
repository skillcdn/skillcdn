import {
  type HostRepository,
  type IndexEntry,
  NO_LICENSE,
  SECTIONING_VERSION,
  sectionsOf,
} from "@skillcdn/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./client.js";
import {
  blobsWithoutVectors,
  claimSnapshot,
  createIndexStore,
  type Database,
  ensureSnapshot,
  migrateDatabase,
  purgeRepositoryIndex,
  recordSnapshotEmbedding,
  type SectionVector,
  type SnapshotScope,
  saveRepository,
  searchSectionVectors,
  supportsSectionVectors,
  type VectorKey,
  writeSectionVectors,
  writeSnapshotIndex,
} from "./index.js";
import { snapshots } from "./schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

// The vectors of sections (ADR-0064) on a database that has the extension, which the compose
// database and the one of CI do. Four dimensions stand in for a model's thousand: the table
// takes the dimensions from the key, not from the column.

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
const KEY: VectorKey = {
  model: "test-model",
  dimensions: 4,
  sectioningVersion: SECTIONING_VERSION,
};

const BILLING = [
  "# Billing",
  "",
  "How a workspace is charged.",
  "",
  "## Plans",
  "",
  "One plan at a time.",
  "",
  "## Invoices",
  "",
  "Sent on the first of the month.",
  "",
].join("\n");
const TOUR = ["A note before the heading.", "", "# Tour", "", "Around the office.", ""].join("\n");

/** The vectors of a body's sections, one unit vector each, in the order the sections come. */
function vectorsOf(blobSha: string, text: string, vectors: readonly number[][]): SectionVector[] {
  const sections = sectionsOf(text);
  expect(sections).toHaveLength(vectors.length);
  return sections.map((section, index) => ({
    ...section,
    blobSha,
    section: index,
    vector: Float32Array.from(vectors[index] ?? []),
  }));
}

const BILLING_VECTORS = vectorsOf("blob-billing", BILLING, [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
]);
const TOUR_VECTORS = vectorsOf("blob-tour", TOUR, [
  [0, 0, 0, 1],
  [0.6, 0.8, 0, 0],
]);

let nextHostId = 5000;
function hostRepository(): HostRepository {
  nextHostId += 1;
  return {
    hostRepoId: String(nextHostId),
    name: "Skills",
    defaultBranch: "main",
    description: undefined,
    visibility: "public",
    owner: { hostAccountId: `9${nextHostId}`, login: "Acme", kind: "organization" },
  };
}

function entry(patch: Partial<IndexEntry> & Pick<IndexEntry, "path" | "blobSha">): IndexEntry {
  return {
    kind: "markdown",
    size: 10,
    skillDir: undefined,
    name: undefined,
    title: undefined,
    description: undefined,
    frontMatter: undefined,
    searchable: true,
    visible: true,
    ...patch,
  };
}

/** A ready snapshot of a repository of its own, with these entries; their bodies are not needed here. */
async function readySnapshot(entries: IndexEntry[]): Promise<SnapshotScope> {
  const alias = { host: "gh" as const, owner: `owner${nextHostId}`, repo: "skills" };
  const repo = await saveRepository(database, alias, hostRepository(), T0);
  const snapshot = await ensureSnapshot(
    database,
    { accountId: repo.accountId, repoId: repo.id },
    "a".repeat(40),
    1,
    T0,
  );
  const scope: SnapshotScope = { accountId: repo.accountId, snapshotId: snapshot.id };
  expect(await claimSnapshot(database, scope, "builder", T0, 60_000)).toBeDefined();
  expect(
    await writeSnapshotIndex(
      database,
      scope,
      "builder",
      {
        entries,
        truncated: false,
        indexedBytes: 0,
        diagnostics: [],
        license: NO_LICENSE,
        version: 1,
      },
      T0,
    ),
  ).toBe(true);
  return scope;
}

const search = (scope: SnapshotScope, mountPath: string, query: number[], limit = 10) =>
  searchSectionVectors(database, scope, mountPath, KEY, Float32Array.from(query), limit);

describe("section vectors", () => {
  it("are kept by a database whose migration found the extension", async () => {
    expect(await supportsSectionVectors(database)).toBe(true);
  });

  it("are written once per body and key, and say which bodies are left", async () => {
    expect(await writeSectionVectors(database, KEY, BILLING_VECTORS)).toBe(3);
    expect(await writeSectionVectors(database, KEY, BILLING_VECTORS)).toBe(0);
    expect(await writeSectionVectors(database, KEY, [])).toBe(0);
    expect(await blobsWithoutVectors(database, KEY, ["blob-billing", "blob-tour"])).toEqual(
      new Set(["blob-tour"]),
    );
    // Another model, other rules: nothing of this is theirs.
    expect(
      await blobsWithoutVectors(database, { ...KEY, model: "other" }, ["blob-billing"]),
    ).toEqual(new Set(["blob-billing"]));
    expect(
      await blobsWithoutVectors(database, { ...KEY, sectioningVersion: 99 }, ["blob-billing"]),
    ).toEqual(new Set(["blob-billing"]));
    expect(await writeSectionVectors(database, KEY, TOUR_VECTORS)).toBe(2);
  });

  it("refuse a vector of other dimensions than the key's, and a query that is not a vector", async () => {
    const [first] = BILLING_VECTORS;
    if (first === undefined) throw new Error("no section");
    await expect(
      writeSectionVectors(database, { ...KEY, model: "wrong-size" }, [
        { ...first, vector: Float32Array.from([1, 0, 0]) },
      ]),
    ).rejects.toMatchObject({ cause: { constraint: "section_vectors_dimensions_check" } });
    const scope = await readySnapshot([
      entry({ path: "docs/billing.md", blobSha: "blob-billing" }),
    ]);
    await expect(search(scope, "", [1, 0, 0])).rejects.toThrow(RangeError);
    await expect(search(scope, "", [1, Number.NaN, 0, 0])).rejects.toThrow(RangeError);
  });

  it("find the nearest sections of a mount's searchable entries, exactly, best first", async () => {
    const scope = await readySnapshot([
      entry({ path: "docs/billing.md", blobSha: "blob-billing" }),
      entry({ path: "tour.md", blobSha: "blob-tour" }),
      // The same bytes, listed but not searchable: found by no search.
      entry({ path: "docs/listed-only.md", blobSha: "blob-billing", searchable: false }),
    ]);
    const found = await search(scope, "", [1, 0, 0, 0]);
    expect(
      found.map((match) => [match.path, match.section, Number(match.similarity.toFixed(3))]),
    ).toEqual([
      ["docs/billing.md", 0, 1],
      ["tour.md", 1, 0.6],
      // Nothing in common with the query: the ties fall in path order, then section order.
      ["docs/billing.md", 1, 0],
      ["docs/billing.md", 2, 0],
      ["tour.md", 0, 0],
    ]);
    // What names a section is what the rules cut: the heading path and what reads it.
    const [best] = found;
    expect(best).toMatchObject({
      blobSha: "blob-billing",
      heading: ["Billing"],
      offset: 0,
      length: BILLING.indexOf("## Plans"),
    });
    expect(found[1]).toMatchObject({ heading: ["Tour"], offset: TOUR.indexOf("# Tour") });

    // A mount sees its own entries only; a limit cuts the list; another key has no vectors.
    expect((await search(scope, "docs", [0, 1, 0, 0])).map((match) => match.path)).toEqual([
      "docs/billing.md",
      "docs/billing.md",
      "docs/billing.md",
    ]);
    expect((await search(scope, "", [0, 0, 0, 1], 1)).map((match) => match.section)).toEqual([0]);
    expect(
      await searchSectionVectors(
        database,
        scope,
        "",
        { ...KEY, model: "other" },
        Float32Array.from([1, 0, 0, 0]),
        10,
      ),
    ).toEqual([]);
  });

  it("serve a second repository that holds the same bytes, through its own entries", async () => {
    const scope = await readySnapshot([entry({ path: "copy.md", blobSha: "blob-billing" })]);
    const found = await search(scope, "", [0, 0, 1, 0]);
    expect(found.map((match) => [match.path, match.section])).toEqual([
      ["copy.md", 2],
      ["copy.md", 0],
      ["copy.md", 1],
    ]);
  });

  it("say how far the embedding of a snapshot has come, as the index store answers it", async () => {
    const scope = await readySnapshot([
      entry({
        path: "SKILLCDN.md",
        blobSha: "blob-progress-root",
        kind: "manifest",
        searchable: false,
      }),
      entry({ path: "docs/a.md", blobSha: "blob-progress-a" }),
      entry({ path: "docs/b.md", blobSha: "blob-progress-b" }),
      entry({
        path: "docs/private/SKILLCDN.md",
        blobSha: "blob-progress-private",
        kind: "manifest",
        searchable: false,
        frontMatter: { metadata: {}, warnings: [], search: { meaning: false } },
      }),
      entry({ path: "docs/private/notes.md", blobSha: "blob-progress-notes" }),
      entry({ path: "docs/data.json", blobSha: "blob-progress-json", kind: "json" }),
    ]);
    expect(createIndexStore(database, scope).embeddingProgress).toBeUndefined();
    const store = createIndexStore(database, scope, { vectors: KEY });
    // Nothing has embedded the snapshot: nothing to say.
    expect(await store.embeddingProgress?.()).toBeUndefined();
    // A slice wrote one of the two bodies to embed: the manifest keeps the notes out, and the
    // JSON file has no sections.
    await writeSectionVectors(
      database,
      KEY,
      vectorsOf("blob-progress-a", TOUR, [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ]),
    );
    await recordSnapshotEmbedding(
      database,
      scope,
      KEY,
      { bodies: 1, sections: 2, tokens: 0, bytes: 10, completed: false },
      T0,
    );
    expect(await store.embeddingProgress?.()).toEqual({
      status: "in_progress",
      embedded: 1,
      total: 2,
    });
    await recordSnapshotEmbedding(
      database,
      scope,
      KEY,
      { bodies: 1, sections: 2, tokens: 0, bytes: 10, completed: true },
      T0,
    );
    expect(await store.embeddingProgress?.()).toEqual({ status: "complete" });
  });

  it("go with the bodies a purge finds unreferenced, and stay with the ones another repository holds", async () => {
    const own = vectorsOf("blob-own", TOUR, [
      [0, 0, 0, 1],
      [0, 0, 1, 0],
    ]);
    expect(await writeSectionVectors(database, KEY, own)).toBe(2);
    const scope = await readySnapshot([
      entry({ path: "own.md", blobSha: "blob-own" }),
      entry({ path: "shared.md", blobSha: "blob-billing" }),
    ]);
    const [repoId] = await drizzleOf(database)
      .select({ repoId: snapshots.repoId })
      .from(snapshots)
      .where(eq(snapshots.id, scope.snapshotId))
      .then((rows) => rows.map((row) => row.repoId));
    expect(repoId).toBeDefined();
    expect(await purgeRepositoryIndex(database, repoId ?? "")).toMatchObject({ snapshots: 1 });
    expect(await blobsWithoutVectors(database, KEY, ["blob-own", "blob-billing"])).toEqual(
      new Set(["blob-own"]),
    );
  });

  it("get their table on the next migrate where it is missing and the extension is there", async () => {
    // As on a database that was migrated before the extension was installed on its server.
    await drizzleOf(database).execute(sql`drop table section_vectors`);
    expect(await supportsSectionVectors(database)).toBe(false);
    const { notices } = await migrateDatabase(testDatabase.connectionString);
    expect(notices).toEqual([]);
    expect(await supportsSectionVectors(database)).toBe(true);
    expect(await writeSectionVectors(database, KEY, BILLING_VECTORS)).toBe(3);
  });
});
