import {
  type HostRepository,
  type IndexEntry,
  NO_LICENSE,
  queryLexemes,
  queryWeights,
  SECTIONING_VERSION,
  searchFieldsOf,
  searchVectorOf,
  serializeSearchVector,
} from "@skillcdn/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database, drizzleOf } from "./client.js";
import {
  claimSnapshot,
  countHubLexemes,
  createBlobStore,
  ensureSnapshot,
  fillPartVectors,
  isStatementTimeout,
  listSearchablePacks,
  PART_SECTIONS,
  type RepoScope,
  saveCachedRef,
  saveRepository,
  searchHubEntries,
  searchHubSectionVectors,
  supportsSectionVectors,
  type VectorKey,
  writeSectionVectors,
  writeSnapshotIndex,
} from "./index.js";
import {
  createTestDatabase,
  DEV_DATABASE_URL,
  readHubStatements,
  type TestDatabase,
} from "./testing.js";

// The search across every pack a deployment serves (ADR-0070): which packs it covers, and the
// words and the meaning over all of them at once.

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

let nextHostId = 5000;
function hostRepository(name: string, visibility: "public" | "private" = "public"): HostRepository {
  nextHostId += 1;
  return {
    hostRepoId: String(nextHostId),
    name,
    defaultBranch: "main",
    description: undefined,
    visibility,
    owner: { hostAccountId: "9001", login: "Acme", kind: "organization" },
  };
}

function entry(patch: Partial<IndexEntry> & Pick<IndexEntry, "path">): IndexEntry {
  return {
    kind: "markdown",
    size: 10,
    blobSha: `sha-${patch.path}`,
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

/** A repository whose default branch is at `commit`, with that commit indexed when `entries` are given. */
async function repository(
  name: string,
  commit: string,
  entries: IndexEntry[] | undefined,
  bodies: Record<string, string> = {},
  visibility: "public" | "private" = "public",
): Promise<RepoScope> {
  const repo = await saveRepository(
    database,
    { host: "gh", owner: "acme", repo: name },
    hostRepository(name, visibility),
    T0,
  );
  const scope = { accountId: repo.accountId, repoId: repo.id };
  await saveCachedRef(database, scope, "", commit, T0);
  if (entries !== undefined) {
    await index(scope, commit, entries, bodies);
  }
  return scope;
}

async function index(
  scope: RepoScope,
  commit: string,
  entries: IndexEntry[],
  bodies: Record<string, string>,
): Promise<string> {
  const snapshot = await ensureSnapshot(database, scope, commit, 1, T0);
  const at = { accountId: scope.accountId, snapshotId: snapshot.id };
  const store = createBlobStore(database);
  for (const [sha, content] of Object.entries(bodies)) {
    await store.write(sha, new TextEncoder().encode(content));
  }
  expect(await claimSnapshot(database, at, "builder", T0, 60_000)).toBeDefined();
  const vectorized = entries.map((item) =>
    item.searchable && item.search === undefined
      ? {
          ...item,
          search: serializeSearchVector(searchVectorOf(searchFieldsOf(item, bodies[item.blobSha]))),
        }
      : item,
  );
  expect(
    await writeSnapshotIndex(
      database,
      at,
      "builder",
      {
        entries: vectorized,
        truncated: false,
        indexedBytes: 0,
        diagnostics: [],
        license: NO_LICENSE,
        version: 1,
      },
      T0,
    ),
  ).toBe(true);
  return snapshot.id;
}

const commit = (letter: string) => letter.repeat(40);

describe("the packs a search across every pack covers", () => {
  it("are the public repositories with an index at the commit their default branch is served from", async () => {
    const indexed = await repository("alpha", commit("a"), [
      entry({ path: "docs/alpha.md", blobSha: "hub-alpha", title: "Alpha" }),
    ]);
    await repository("beta", commit("b"), [
      entry({ path: "docs/beta.md", blobSha: "hub-beta", title: "Beta" }),
    ]);
    // Private: not searched, whatever it holds.
    await repository(
      "secret",
      commit("c"),
      [entry({ path: "docs/secret.md", blobSha: "hub-secret", title: "Secret" })],
      {},
      "private",
    );
    // Opted out by its root manifest.
    await repository("quiet", commit("d"), [
      entry({
        path: "SKILLCDN.md",
        blobSha: "hub-quiet-manifest",
        kind: "manifest",
        searchable: false,
        frontMatter: { metadata: {}, warnings: [], search: { meaning: true, hub: false } },
      }),
      entry({ path: "docs/quiet.md", blobSha: "hub-quiet", title: "Quiet" }),
    ]);
    // Never indexed: nothing to search.
    await repository("empty", commit("e"), undefined);
    // Moved on to a commit that has no index yet: served, and searched, at the commit before.
    const moved = await repository("moved", commit("f"), [
      entry({ path: "docs/moved.md", blobSha: "hub-moved", title: "Moved" }),
    ]);
    await saveCachedRef(database, moved, "", commit("0"), new Date(T0.getTime() + 60_000));

    const packs = await listSearchablePacks(database);
    expect(packs.map((pack) => `${pack.owner}/${pack.name}`)).toEqual([
      "Acme/alpha",
      "Acme/beta",
      "Acme/moved",
    ]);
    expect(packs.every((pack) => pack.host === "gh")).toBe(true);
    expect(packs.find((pack) => pack.name === "alpha")?.repoId).toBe(indexed.repoId);
    expect(packs.find((pack) => pack.name === "alpha")?.license).toEqual(NO_LICENSE);
    // What each pack is: a repository read without a manifest, here, holding no skill.
    expect(packs.find((pack) => pack.name === "alpha")).toMatchObject({
      hasManifest: false,
      skillCount: 0,
    });
  });
});

describe("the words and the meaning across every pack", () => {
  it("finds the entries of several packs at once, weighed by rarity across them all", async () => {
    const one = await repository(
      "codes-one",
      commit("1"),
      [entry({ path: "docs/one.md", blobSha: "hub-one" })],
      { "hub-one": "VDS" },
    );
    const two = await repository(
      "codes-two",
      commit("2"),
      [
        entry({ path: "docs/two.md", blobSha: "hub-two" }),
        entry({
          path: "skills/x/SKILL.md",
          blobSha: "hub-x",
          kind: "skill",
          skillDir: "skills/x",
          name: "x",
          description: "VDS forms",
        }),
      ],
      { "hub-two": "4205 standard list", "hub-x": "" },
    );
    const packs = await listSearchablePacks(database);
    const ids = packs
      .filter((pack) => pack.repoId === one.repoId || pack.repoId === two.repoId)
      .map((pack) => pack.snapshotId);
    expect(ids).toHaveLength(2);
    expect(packs.find((pack) => pack.repoId === two.repoId)?.skillCount).toBe(1);

    const lexemes = queryLexemes("VDS 4205");
    const counted = await countHubLexemes(database, ids, lexemes, 5000);
    expect(counted).toEqual({ total: 3, counts: [2, 1] });
    expect(await countHubLexemes(database, [], lexemes, 5000)).toEqual({
      total: 0,
      counts: [0, 0],
    });

    const plain = await searchHubEntries(database, ids, lexemes, undefined, 10, 5000);
    // A skill outranks a document, as inside one pack; then the shorter document.
    expect(plain.map((row) => row.path)).toEqual([
      "skills/x/SKILL.md",
      "docs/one.md",
      "docs/two.md",
    ]);
    expect(plain.map((row) => row.snapshotId)).toEqual([ids[1], ids[0], ids[1]]);
    const weighed = await searchHubEntries(
      database,
      ids,
      lexemes,
      queryWeights(counted.total, counted.counts),
      10,
      5000,
    );
    // Weighed by rarity, the document that holds the rare code passes the one with the common word;
    // the skill, boosted and matched in its description, stays first.
    expect(weighed.map((row) => row.path)).toEqual([
      "skills/x/SKILL.md",
      "docs/two.md",
      "docs/one.md",
    ]);
    expect(await searchHubEntries(database, ids, lexemes, undefined, 1, 5000)).toHaveLength(1);
    expect(await searchHubEntries(database, [], lexemes, undefined, 10, 5000)).toEqual([]);
  });

  it("finds the sections nearest in meaning across the packs, with the entry each belongs to", async () => {
    if (!(await supportsSectionVectors(database))) {
      throw new Error("the test database has no vector extension; the compose file's image has it");
    }
    const near = await repository(
      "meaning-near",
      commit("3"),
      [entry({ path: "docs/near.md", blobSha: "hub-near", title: "Near" })],
      { "hub-near": "# Near\n\nClose by.\n" },
    );
    const far = await repository(
      "meaning-far",
      commit("4"),
      [entry({ path: "docs/far.md", blobSha: "hub-far", title: "Far" })],
      { "hub-far": "# Far\n\nFar away.\n" },
    );
    await writeSectionVectors(database, KEY, [
      {
        blobSha: "hub-near",
        section: 0,
        heading: ["Near"],
        offset: 0,
        length: 20,
        vector: Float32Array.from([1, 0, 0, 0]),
      },
      {
        blobSha: "hub-far",
        section: 0,
        heading: ["Far"],
        offset: 0,
        length: 18,
        vector: Float32Array.from([0, 1, 0, 0]),
      },
    ]);
    const ids = (await listSearchablePacks(database))
      .filter((pack) => pack.repoId === near.repoId || pack.repoId === far.repoId)
      .map((pack) => pack.snapshotId);
    // Through the parts picked first, and with every section compared: the same answer here.
    for (const parts of [10, 0]) {
      const found = await searchHubSectionVectors(
        database,
        ids,
        KEY,
        Float32Array.from([1, 0, 0, 0]),
        10,
        5000,
        parts,
      );
      expect(
        found.map((match) => [match.path, match.title, match.heading, match.similarity]),
      ).toEqual([
        ["docs/near.md", "Near", ["Near"], 1],
        ["docs/far.md", "Far", ["Far"], 0],
      ]);
      expect(found[0]?.snapshotId).toBe(ids.find((id) => id !== found[1]?.snapshotId));
    }
    await expect(
      searchHubSectionVectors(database, ids, KEY, Float32Array.from([1, 0]), 10, 5000, 10),
    ).rejects.toThrow(RangeError);
  });

  it("picks the parts nearest the query, and compares the sections of those alone (ADR-0092)", async () => {
    // A long document says one thing in its first sections, another in the next, and what is
    // asked for in its last: the mean of everything it says is near none of them.
    const long = await repository(
      "parts-long",
      commit("7"),
      [entry({ path: "docs/long.md", blobSha: "hub-long", title: "Long" })],
      { "hub-long": "# Long\n\nMany sections.\n" },
    );
    const short = await repository(
      "parts-short",
      commit("8"),
      [entry({ path: "docs/short.md", blobSha: "hub-short", title: "Short" })],
      { "hub-short": "# Short\n\nOne section.\n" },
    );
    // The same bytes in a second pack: one body, an entry in each.
    const copy = await repository(
      "parts-copy",
      commit("9"),
      [entry({ path: "notes/short.md", blobSha: "hub-short", title: "Short" })],
      { "hub-short": "# Short\n\nOne section.\n" },
    );
    const directionOf = (section: number): number[] =>
      section < PART_SECTIONS
        ? [0, 1, 0, 0]
        : section < 2 * PART_SECTIONS
          ? [0, 0, 1, 0]
          : [0, 0, 0, 1];
    await writeSectionVectors(database, KEY, [
      ...Array.from({ length: 2 * PART_SECTIONS + 1 }, (_, section) => ({
        blobSha: "hub-long",
        section,
        heading: [`Section ${section}`],
        offset: section * 10,
        length: 10,
        vector: Float32Array.from(directionOf(section)),
      })),
      {
        blobSha: "hub-short",
        section: 0,
        heading: ["Short"],
        offset: 0,
        length: 10,
        vector: Float32Array.from([0, 0, 0.6, 0.8]),
      },
    ]);
    const ids = (await listSearchablePacks(database))
      .filter((pack) => [long.repoId, short.repoId, copy.repoId].includes(pack.repoId))
      .map((pack) => pack.snapshotId);
    const ask = async (parts: number) =>
      (
        await searchHubSectionVectors(
          database,
          ids,
          KEY,
          Float32Array.from([0, 0, 0, 1]),
          30,
          5000,
          parts,
        )
      ).map((match) => `${match.path} ${match.section}`);
    // One part: the last of the long document, whose one section is what was asked for.
    expect(await ask(1)).toEqual([`docs/long.md ${2 * PART_SECTIONS}`]);
    // Two: the short body as well, once for each pack that holds it, and still nothing of the
    // long document's other parts.
    expect(await ask(2)).toEqual([
      `docs/long.md ${2 * PART_SECTIONS}`,
      "docs/short.md 0",
      "notes/short.md 0",
    ]);
    // With every section compared the long document's other sections follow, as before.
    expect(await ask(0)).toHaveLength(2 * PART_SECTIONS + 3);
  });

  it("finds a body by meaning once its part vectors are filled, where its sections came first", async () => {
    const early = await repository(
      "parts-early",
      commit("a"),
      [entry({ path: "docs/early.md", blobSha: "hub-early", title: "Early" })],
      { "hub-early": "# Early\n\nWritten before.\n" },
    );
    // As the vectors of a deployment are before the sweep has made their parts.
    await drizzleOf(database).execute(
      sql`insert into section_vectors (blob_sha, model, dimensions, sectioning_version, section, heading, "offset", length, vector)
        values ('hub-early', ${KEY.model}, ${KEY.dimensions}, ${KEY.sectioningVersion}, 0, '["Early"]', 0, 10, '[0.8,0,0,0.6]')`,
    );
    const ids = (await listSearchablePacks(database))
      .filter((pack) => pack.repoId === early.repoId)
      .map((pack) => pack.snapshotId);
    const query = Float32Array.from([1, 0, 0, 0]);
    expect(await searchHubSectionVectors(database, ids, KEY, query, 10, 5000, 10)).toEqual([]);
    expect(await fillPartVectors(database, KEY, 100)).toBe(1);
    const found = await searchHubSectionVectors(database, ids, KEY, query, 10, 5000, 10);
    expect(found.map((match) => match.path)).toEqual(["docs/early.md"]);
  });

  it("counts the findable entries of the packs searched, and no others", async () => {
    const counted = await repository(
      "counted",
      commit("5"),
      [
        entry({ path: "docs/kept.md", blobSha: "hub-kept" }),
        // Left out by the reading rules: its words are in the index and found by nothing.
        entry({ path: "notes/hidden.md", blobSha: "hub-hidden", visible: false }),
        // Listed, and not searched.
        entry({ path: "src/tool.ts", blobSha: "hub-tool", kind: "other", searchable: false }),
      ],
      { "hub-kept": "quokka marsupial", "hub-hidden": "quokka" },
    );
    const beside = await repository(
      "beside",
      commit("6"),
      [entry({ path: "docs/beside.md", blobSha: "hub-beside" })],
      { "hub-beside": "quokka" },
    );
    const packs = await listSearchablePacks(database);
    const idOf = (scope: RepoScope): string =>
      packs.find((pack) => pack.repoId === scope.repoId)?.snapshotId ?? "";
    const lexemes = queryLexemes("quokka marsupial wombat");
    expect(lexemes).toHaveLength(3);

    // A word nothing holds counts nothing, and the pack beside is not counted unless searched.
    expect(await countHubLexemes(database, [idOf(counted)], lexemes, 5000)).toEqual({
      total: 1,
      counts: [1, 1, 0],
    });
    expect(await countHubLexemes(database, [idOf(counted), idOf(beside)], lexemes, 5000)).toEqual({
      total: 2,
      counts: [2, 1, 0],
    });
    expect(await countHubLexemes(database, [idOf(counted)], [], 5000)).toEqual({
      total: 1,
      counts: [],
    });
  });

  it("reads the findable entries, and not the files a pack holds beside them", async () => {
    // A repository as a deployment holds many: a few documents among thousands of files.
    const files = Array.from({ length: 4000 }, (_, at) =>
      entry({
        path: `src/f${at}.ts`,
        blobSha: `hub-file-${at}`,
        kind: "other",
        searchable: false,
        visible: at % 2 === 0,
      }),
    );
    const documents = Array.from({ length: 20 }, (_, at) =>
      entry({ path: `docs/d${at}.md`, blobSha: `hub-document-${at}` }),
    );
    const large = await repository(
      "large",
      commit("7"),
      [...files, ...documents],
      Object.fromEntries(
        documents.map((document, at) => [
          document.blobSha,
          at === 0 ? "numbat termite" : "termite mound",
        ]),
      ),
    );
    await writeSectionVectors(
      database,
      KEY,
      documents.map((document) => ({
        blobSha: document.blobSha,
        section: 0,
        heading: [],
        offset: 0,
        length: 10,
        vector: Float32Array.from([0, 0, 1, 0]),
      })),
    );
    // What the planner knows of the table is what autovacuum tells it on a deployment.
    await drizzleOf(database).execute(sql`analyze index_entries`);
    const ids = (await listSearchablePacks(database))
      .filter((pack) => pack.repoId === large.repoId)
      .map((pack) => pack.snapshotId);
    const lexemes = queryLexemes("numbat termite");
    const counted = await countHubLexemes(database, ids, lexemes, 5000);
    expect(counted).toEqual({ total: 20, counts: [1, 20] });

    const reading = await readHubStatements(database, {
      snapshotIds: ids,
      lexemes,
      weights: queryWeights(counted.total, counted.counts),
      limit: 10,
      meaning: { key: KEY, query: Float32Array.from([0, 0, 1, 0]), parts: 5 },
    });
    // The count reads the twenty once for the total and once more for each word they hold, and
    // nothing of the four thousand files.
    expect(reading.count.entries).toBeLessThanOrEqual(20 + 1 + 20);
    expect(reading.count.indexes).toEqual([
      "index_entries_findable_idx",
      "index_entries_search_idx",
    ]);
    // How the words and the meaning go about it is the planner's to choose in a table this
    // small; what they may not do is read the files.
    expect(reading.words?.entries).toBeLessThan(1000);
    expect(reading.meaning?.entries).toBeLessThan(1000);
  });

  it("tells a statement the server cancelled for its time from any other failure", () => {
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(isStatementTimeout(new Error("wrapped", { cause: { code: "57014" } }))).toBe(true);
    expect(isStatementTimeout({ code: "23505" })).toBe(false);
    expect(isStatementTimeout(new Error("plain"))).toBe(false);
    expect(isStatementTimeout(undefined)).toBe(false);
  });
});
