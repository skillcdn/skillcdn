import {
  HEAD_SECTION,
  type HostRepository,
  type IndexEntry,
  NO_LICENSE,
  SECTIONING_VERSION,
  sectionsOf,
} from "@skillcdn/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./client.js";
import {
  blobsWithoutVectors,
  claimSnapshot,
  countSkillBodiesWithoutHead,
  createIndexStore,
  type Database,
  ensureSnapshot,
  fillPartVectors,
  HEAD_PART,
  migrateDatabase,
  PART_SECTIONS,
  purgeRepositoryIndex,
  recordSnapshotEmbedding,
  type SectionVector,
  type SnapshotScope,
  saveCachedRef,
  saveRepository,
  searchSectionVectors,
  skillBodiesWithoutHead,
  supportsSectionVectors,
  type VectorKey,
  vectorsOfTexts,
  writeSectionVectors,
  writeSnapshotIndex,
} from "./index.js";
import { partVectors, sectionHalves, snapshots } from "./schema.js";
import {
  createTestDatabase,
  DEV_DATABASE_URL,
  dropSectionHalves,
  type TestDatabase,
} from "./testing.js";

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

/** The part vectors of a body under the key, by part: how many sections each stands for, and its vector. */
async function partsOf(
  blobSha: string,
): Promise<{ part: number; sections: number; vector: number[] }[]> {
  const rows = await drizzleOf(database)
    .select({
      part: partVectors.part,
      sections: partVectors.sections,
      vector: partVectors.vector,
      model: partVectors.model,
    })
    .from(partVectors)
    .where(eq(partVectors.blobSha, blobSha))
    .orderBy(partVectors.part);
  return rows
    .filter((row) => row.model === KEY.model)
    .map((row) => ({
      part: row.part,
      sections: row.sections,
      vector: Array.from(
        row.vector as unknown as Iterable<number>,
        (value) => Math.round(value * 1000) / 1000,
      ),
    }));
}

/** The sections of a body kept at half precision under the key (ADR-0103), by section, with their vectors. */
async function halvesOf(blobSha: string): Promise<{ section: number; vector: number[] }[]> {
  const rows = await drizzleOf(database)
    .select({ section: sectionHalves.section, vector: sectionHalves.vector })
    .from(sectionHalves)
    .where(and(eq(sectionHalves.blobSha, blobSha), eq(sectionHalves.model, KEY.model)))
    .orderBy(sectionHalves.section);
  return rows.map((row) => ({
    section: row.section,
    vector: Array.from(row.vector as unknown as Iterable<number>),
  }));
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

  it("are found again by the hash of the text they were made from, under the model that made them (ADR-0093)", async () => {
    const hashed: SectionVector[] = [
      {
        blobSha: "blob-hashed",
        section: 0,
        heading: ["One"],
        offset: 0,
        length: 10,
        vector: Float32Array.from([0, 0, 1, 0]),
        textHash: "hash-of-one",
      },
      {
        blobSha: "blob-hashed",
        section: 1,
        heading: ["Two"],
        offset: 10,
        length: 10,
        vector: Float32Array.from([0, 0, 0, 1]),
        textHash: "hash-of-two",
      },
    ];
    expect(await writeSectionVectors(database, KEY, hashed)).toBe(2);
    const found = await vectorsOfTexts(database, KEY, [
      "hash-of-one",
      "hash-of-two",
      "hash-of-nothing",
      "hash-of-one",
    ]);
    expect([...found.keys()].sort()).toEqual(["hash-of-one", "hash-of-two"]);
    expect(Array.from(found.get("hash-of-two") ?? [])).toEqual([0, 0, 0, 1]);
    // The vector is the model's reading of the text: the rules that cut it out do not change it,
    // and another model reads it otherwise.
    const cutOtherwise = { ...KEY, sectioningVersion: KEY.sectioningVersion + 1 };
    expect((await vectorsOfTexts(database, cutOtherwise, ["hash-of-one"])).size).toBe(1);
    expect(
      (await vectorsOfTexts(database, { ...KEY, model: "another-model" }, ["hash-of-one"])).size,
    ).toBe(0);
    // The vectors written without a hash, as every one before this was, are found by none.
    expect((await vectorsOfTexts(database, KEY, [])).size).toBe(0);
    expect(await blobsWithoutVectors(database, KEY, ["blob-hashed", "blob-billing"])).toEqual(
      new Set(),
    );
  });

  it("have the vectors of the body's parts made with them, the mean of every few sections (ADR-0092)", async () => {
    // Billing was written above: three sections, so one part, the mean of the three.
    expect(await partsOf("blob-billing")).toEqual([
      { part: 0, sections: 3, vector: [0.333, 0.333, 0.333, 0] },
    ]);
    // A body of more sections than a part holds has a part for each run of them.
    const long: SectionVector[] = Array.from({ length: PART_SECTIONS + 2 }, (_, section) => ({
      blobSha: "blob-long",
      section,
      heading: [`Section ${section}`],
      offset: section * 10,
      length: 10,
      vector: Float32Array.from(section < PART_SECTIONS ? [1, 0, 0, 0] : [0, 0, 0, 1]),
    }));
    expect(await writeSectionVectors(database, KEY, long)).toBe(PART_SECTIONS + 2);
    expect(await partsOf("blob-long")).toEqual([
      { part: 0, sections: PART_SECTIONS, vector: [1, 0, 0, 0] },
      { part: 1, sections: 2, vector: [0, 0, 0, 1] },
    ]);
    // Each section is kept at half precision beside them (ADR-0103).
    expect(await halvesOf("blob-long")).toEqual(
      long.map((item) => ({ section: item.section, vector: Array.from(item.vector) })),
    );
    // Nothing is left to fill where every body was written with its parts.
    expect(await fillPartVectors(database, KEY, 100)).toBe(0);
  });

  it("fills the part vectors of bodies whose sections were written before there were any", async () => {
    // As a deployment's vectors are on the day it is given the table: sections, and no parts.
    await drizzleOf(database).delete(partVectors);
    expect(await partsOf("blob-billing")).toEqual([]);
    // In steps of as many bodies as it is asked for, until none is left.
    const first = await fillPartVectors(database, KEY, 1);
    expect(first).toBe(1);
    let filled = first;
    for (let step = await fillPartVectors(database, KEY, 2); step > 0; ) {
      filled += step;
      step = await fillPartVectors(database, KEY, 2);
    }
    expect(filled).toBeGreaterThanOrEqual(3);
    expect(await partsOf("blob-billing")).toEqual([
      { part: 0, sections: 3, vector: [0.333, 0.333, 0.333, 0] },
    ]);
    expect((await partsOf("blob-long")).map((part) => part.sections)).toEqual([PART_SECTIONS, 2]);
    // Another key's sections are not this key's to fill.
    expect(await fillPartVectors(database, { ...KEY, model: "another-model" }, 100)).toBe(0);
  });

  it("fills the sections at half precision of bodies whose parts were made before there were any (ADR-0103)", async () => {
    // As a deployment's vectors are on the day it is given that table: sections and parts.
    expect(await dropSectionHalves(database)).toBeGreaterThan(0);
    const parts = await partsOf("blob-long");
    expect(await halvesOf("blob-long")).toEqual([]);
    let filled = 0;
    for (let step = await fillPartVectors(database, KEY, 2); step > 0; ) {
      filled += step;
      step = await fillPartVectors(database, KEY, 2);
    }
    expect(filled).toBeGreaterThanOrEqual(3);
    expect((await halvesOf("blob-long")).map((half) => half.section)).toEqual(
      Array.from({ length: PART_SECTIONS + 2 }, (_, section) => section),
    );
    expect(await partsOf("blob-long")).toEqual(parts);
    // A body one of whose sections was left without is filled as well.
    await drizzleOf(database)
      .delete(sectionHalves)
      .where(and(eq(sectionHalves.blobSha, "blob-long"), eq(sectionHalves.section, 1)));
    expect(await fillPartVectors(database, KEY, 100)).toBe(1);
    expect(await halvesOf("blob-long")).toHaveLength(PART_SECTIONS + 2);
  });

  it("drops the part vectors with the sections of a body nothing names any more", async () => {
    const gone = vectorsOf("blob-gone", TOUR, [
      [0, 0, 0, 1],
      [0, 0, 1, 0],
    ]);
    expect(await writeSectionVectors(database, KEY, gone)).toBe(2);
    expect(await partsOf("blob-gone")).toHaveLength(1);
    const scope = await readySnapshot([entry({ path: "gone.md", blobSha: "blob-gone" })]);
    const [repoId] = await drizzleOf(database)
      .select({ repoId: snapshots.repoId })
      .from(snapshots)
      .where(eq(snapshots.id, scope.snapshotId))
      .then((rows) => rows.map((row) => row.repoId));
    expect(await halvesOf("blob-gone")).toHaveLength(2);
    expect(await purgeRepositoryIndex(database, repoId ?? "")).toMatchObject({ snapshots: 1 });
    expect(await partsOf("blob-gone")).toEqual([]);
    expect(await halvesOf("blob-gone")).toEqual([]);
    // A body another repository still holds keeps them all.
    expect(await partsOf("blob-billing")).toHaveLength(1);
    expect(await halvesOf("blob-billing")).toHaveLength(3);
  });

  it("keep a skill's head before its sections, a part of its own, compared for the skill alone (ADR-0094)", async () => {
    const head = (blobSha: string, vector: number[]): SectionVector => ({
      blobSha,
      section: HEAD_SECTION,
      heading: [],
      offset: 0,
      length: 0,
      vector: Float32Array.from(vector),
    });
    const skill = [
      head("blob-skill", [1, 0, 0, 0]),
      ...vectorsOf("blob-skill", TOUR, [
        [0, 0, 0, 1],
        [0, 0, 1, 0],
      ]),
    ];
    expect(await writeSectionVectors(database, KEY, skill)).toBe(3);
    // The head is a part alone, and the mean of the sections is of the sections.
    expect(await partsOf("blob-skill")).toEqual([
      { part: HEAD_PART, sections: 1, vector: [1, 0, 0, 0] },
      { part: 0, sections: 2, vector: [0, 0, 0.5, 0.5] },
    ]);
    const scope = await readySnapshot([
      entry({
        path: "skills/tour/SKILL.md",
        blobSha: "blob-skill",
        kind: "skill",
        skillDir: "skills/tour",
        name: "tour",
        description: "Shows people around.",
      }),
      // The same bytes as a document of another folder: the head is the skill's alone.
      entry({ path: "notes/tour.md", blobSha: "blob-skill" }),
    ]);
    const found = await search(scope, "", [1, 0, 0, 0]);
    expect(
      found.map((match) => [match.path, match.section, Number(match.similarity.toFixed(3))]),
    ).toEqual([
      ["skills/tour/SKILL.md", HEAD_SECTION, 1],
      ["notes/tour.md", 0, 0],
      ["notes/tour.md", 1, 0],
      ["skills/tour/SKILL.md", 0, 0],
      ["skills/tour/SKILL.md", 1, 0],
    ]);
    // A head names no passage.
    expect(found[0]).toMatchObject({ heading: [], offset: 0, length: 0 });
  });

  it("name the skills embedded before a skill had a head, until each has its own (ADR-0094)", async () => {
    // Sections and no head, as a deployment's skills are on the day a skill is given one.
    const old = vectorsOf("blob-old-skill", TOUR, [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
    expect(await writeSectionVectors(database, KEY, old)).toBe(2);
    await readySnapshot([
      entry({
        path: "skills/old/SKILL.md",
        blobSha: "blob-old-skill",
        kind: "skill",
        skillDir: "skills/old",
        name: "old",
        description: "Was here before.",
      }),
      // A skill none of whose sections has a vector is the slice's to embed, head and all.
      entry({
        path: "skills/new/SKILL.md",
        blobSha: "blob-unembedded",
        kind: "skill",
        skillDir: "skills/new",
        name: "new",
        description: "Not embedded yet.",
      }),
      // A document has no head to lack, and a skill nobody can find is given none.
      entry({ path: "docs/billing.md", blobSha: "blob-billing" }),
      entry({
        path: "skills/hidden/SKILL.md",
        blobSha: "blob-tour",
        kind: "skill",
        skillDir: "skills/hidden",
        name: "hidden",
        description: "Listed, not searched.",
        searchable: false,
      }),
    ]);
    expect(await skillBodiesWithoutHead(database, KEY, 10)).toEqual([
      { blobSha: "blob-old-skill", name: "old", description: "Was here before." },
    ]);
    expect(await countSkillBodiesWithoutHead(database, KEY)).toBe(1);
    expect(await skillBodiesWithoutHead(database, { ...KEY, model: "another-model" }, 10)).toEqual(
      [],
    );
    expect(await countSkillBodiesWithoutHead(database, { ...KEY, model: "another-model" })).toBe(0);
    // A skill of the commit a ref is served from is what a search reads now: it comes before
    // the skill of a commit kept from before, whatever their hashes.
    const read = vectorsOf("blob-z-read-now", TOUR, [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
    expect(await writeSectionVectors(database, KEY, read)).toBe(2);
    const servedScope = await readySnapshot([
      entry({
        path: "skills/read/SKILL.md",
        blobSha: "blob-z-read-now",
        kind: "skill",
        skillDir: "skills/read",
        name: "read",
        description: "Read by a search now.",
      }),
    ]);
    const [served] = await drizzleOf(database)
      .select({ repoId: snapshots.repoId, commitSha: snapshots.commitSha })
      .from(snapshots)
      .where(eq(snapshots.id, servedScope.snapshotId));
    await saveCachedRef(
      database,
      { accountId: servedScope.accountId, repoId: served?.repoId ?? "" },
      "",
      served?.commitSha ?? "",
      T0,
    );
    expect(await skillBodiesWithoutHead(database, KEY, 10)).toEqual([
      { blobSha: "blob-z-read-now", name: "read", description: "Read by a search now." },
      { blobSha: "blob-old-skill", name: "old", description: "Was here before." },
    ]);
    expect(await skillBodiesWithoutHead(database, KEY, 1)).toEqual([
      { blobSha: "blob-z-read-now", name: "read", description: "Read by a search now." },
    ]);
    expect(await countSkillBodiesWithoutHead(database, KEY)).toBe(2);
    expect(
      await writeSectionVectors(database, KEY, [
        {
          blobSha: "blob-z-read-now",
          section: HEAD_SECTION,
          heading: [],
          offset: 0,
          length: 0,
          vector: Float32Array.from([1, 0, 0, 0]),
        },
      ]),
    ).toBe(1);
    // The head written, its part is made beside the part of the sections, and it is named no more.
    expect(
      await writeSectionVectors(database, KEY, [
        {
          blobSha: "blob-old-skill",
          section: HEAD_SECTION,
          heading: [],
          offset: 0,
          length: 0,
          vector: Float32Array.from([0, 0, 0, 1]),
        },
      ]),
    ).toBe(1);
    expect(await partsOf("blob-old-skill")).toEqual([
      { part: HEAD_PART, sections: 1, vector: [0, 0, 0, 1] },
      { part: 0, sections: 2, vector: [0, 0.5, 0.5, 0] },
    ]);
    expect(await skillBodiesWithoutHead(database, KEY, 10)).toEqual([]);
    expect(await countSkillBodiesWithoutHead(database, KEY)).toBe(0);
  });

  it("get their table on the next migrate where it is missing and the extension is there", async () => {
    // As on a database that was migrated before the extension was installed on its server.
    await drizzleOf(database).execute(sql`drop table section_halves`);
    await drizzleOf(database).execute(sql`drop table part_vectors`);
    await drizzleOf(database).execute(sql`drop table section_vectors`);
    expect(await supportsSectionVectors(database)).toBe(false);
    const { notices } = await migrateDatabase(testDatabase.connectionString);
    expect(notices).toEqual([]);
    expect(await supportsSectionVectors(database)).toBe(true);
    expect(await writeSectionVectors(database, KEY, BILLING_VECTORS)).toBe(3);
    // The tables of the parts and of the sections at half precision came back with it.
    expect(await partsOf("blob-billing")).toHaveLength(1);
    expect(await halvesOf("blob-billing")).toHaveLength(3);
  });

  it("gets the tables of the part vectors and the half sections on the next migrate where the extension was updated since", async () => {
    // As on a database whose extension had no half-precision type when it was migrated: the
    // table of the sections, and none of the parts or of the sections at half precision.
    await drizzleOf(database).execute(sql`drop table section_halves`);
    await drizzleOf(database).execute(sql`drop table part_vectors`);
    expect(await fillPartVectors(database, KEY, 100)).toBe(0);
    await migrateDatabase(testDatabase.connectionString);
    expect(await fillPartVectors(database, KEY, 100)).toBe(1);
    expect(await partsOf("blob-billing")).toHaveLength(1);
    expect(await halvesOf("blob-billing")).toHaveLength(3);
  });

  it("gets the table of the half sections on the next migrate where the parts had theirs already", async () => {
    // As on a database migrated by a release that knew the parts and not the half sections,
    // where a migration was skipped since.
    await drizzleOf(database).execute(sql`drop table section_halves`);
    expect(await fillPartVectors(database, KEY, 100)).toBe(0);
    await migrateDatabase(testDatabase.connectionString);
    expect(await fillPartVectors(database, KEY, 100)).toBe(1);
    expect(await halvesOf("blob-billing")).toHaveLength(3);
  });
});
