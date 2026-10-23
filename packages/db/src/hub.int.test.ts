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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "./client.js";
import {
  claimSnapshot,
  countHubLexemes,
  createBlobStore,
  ensureSnapshot,
  isStatementTimeout,
  listSearchablePacks,
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
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

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
    const found = await searchHubSectionVectors(
      database,
      ids,
      KEY,
      Float32Array.from([1, 0, 0, 0]),
      10,
      5000,
    );
    expect(
      found.map((match) => [match.path, match.title, match.heading, match.similarity]),
    ).toEqual([
      ["docs/near.md", "Near", ["Near"], 1],
      ["docs/far.md", "Far", ["Far"], 0],
    ]);
    expect(found[0]?.snapshotId).toBe(ids.find((id) => id !== found[1]?.snapshotId));
    await expect(
      searchHubSectionVectors(database, ids, KEY, Float32Array.from([1, 0]), 10, 5000),
    ).rejects.toThrow(RangeError);
  });

  it("tells a statement the server cancelled for its time from any other failure", () => {
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(isStatementTimeout(new Error("wrapped", { cause: { code: "57014" } }))).toBe(true);
    expect(isStatementTimeout({ code: "23505" })).toBe(false);
    expect(isStatementTimeout(new Error("plain"))).toBe(false);
    expect(isStatementTimeout(undefined)).toBe(false);
  });
});
