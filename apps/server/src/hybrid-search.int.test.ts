import { createHash } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import {
  allowEverything,
  discardUsage,
  type Embedder,
  type Reranker,
  restFindSchema,
  restMountSchema,
  restSearchSchema,
} from "@skillcdn/core";
import { createBlobStore, ensureSnapshot, findRepoByAlias, type SnapshotScope } from "@skillcdn/db";
import {
  createTestDatabase,
  DEV_DATABASE_URL,
  holdIndexEntries,
  type TestDatabase,
} from "@skillcdn/db/testing";
import { INDEX_VERSION } from "@skillcdn/indexer";
import { InferenceError } from "@skillcdn/inference";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vectorKeyOf } from "./adapters/meaning.js";
import { HUB_DEFAULTS } from "./config/config.js";
import { embedSnapshotSlice } from "./jobs/embed-snapshot.js";
import { createFixtureHost, type FixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness } from "./testing/harness.js";
import { textOf } from "./testing/tool-text.js";

// The search by words and by meaning (ADR-0063 point 5, ADR-0064, ADR-0065) over the document
// pack, with an embedder and a reranker that answer in the process: a question in other words
// than the handbook's finds its section by meaning, the two lists are fused, the first results
// are reranked, and whichever layer does not answer leaves the words to answer alone, which the
// result says in one line and in one field.

const DIMENSIONS = 64;
/** What the embedder knows that the words do not: a few words that mean another. */
const SYNONYMS: Readonly<Record<string, string>> = {
  pardon: "waive",
  pardons: "waive",
  waived: "waive",
  tardy: "late",
  penalties: "fee",
  penalty: "fee",
  fees: "fee",
};

const tokensOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z]+/g) ?? []).map((token) => SYNONYMS[token] ?? token);

const dimensionOf = (token: string): number =>
  (createHash("sha1").update(token).digest()[0] ?? 0) % DIMENSIONS;

/** A bag of words as a unit vector: texts that share words point the same way. */
function vectorOf(text: string): Float32Array {
  const vector = new Float32Array(DIMENSIONS);
  for (const token of tokensOf(text)) {
    const at = dimensionOf(token);
    vector[at] = (vector[at] ?? 0) + 1;
  }
  const length = Math.hypot(...vector);
  return length === 0 ? vector : vector.map((value) => value / length);
}

function fakeEmbedder() {
  const calls: { readonly texts: readonly string[]; readonly as: string }[] = [];
  let failNext: Error | undefined;
  const embedder: Embedder = {
    model: "bag-of-words",
    dimensions: DIMENSIONS,
    maxTexts: 16,
    maxTextChars: 8000,
    maxBatchChars: 32_000,
    async embed(texts, as) {
      if (failNext !== undefined) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      calls.push({ texts: [...texts], as });
      return { vectors: texts.map(vectorOf), tokens: 0 };
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

/** A reranker that scores a candidate 1 when it holds the marker it was told to prefer, else 0. */
function fakeReranker() {
  const calls: string[][] = [];
  let marker: string | undefined;
  let failNext: Error | undefined;
  const reranker: Reranker = {
    model: "marker",
    maxCandidates: 32,
    async rerank(_query, candidates) {
      if (failNext !== undefined) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      calls.push([...candidates]);
      return candidates.map((candidate) =>
        marker !== undefined && candidate.includes(marker) ? 1 : 0,
      );
    },
  };
  return {
    reranker,
    calls,
    prefer(wanted: string | undefined) {
      marker = wanted;
    },
    fail(error: Error) {
      failNext = error;
    },
  };
}

let testDatabase: TestDatabase;
let host: FixtureHost;
let h: Harness;
let client: Client;
const embed = fakeEmbedder();
const rerank = fakeReranker();
const KEY = vectorKeyOf(embed.embedder);
const ADDRESS = "/gh/acme/document-pack";

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  host = createFixtureHost();
  h = createHarness(testDatabase, {
    host,
    meaning: {
      embedder: embed.embedder,
      reranker: rerank.reranker,
      rerankCandidates: 10,
      key: KEY,
    },
  });
  client = await h.connect(ADDRESS);
  // Indexed through the api, embedded as the worker embeds a commit it is handed.
  await client.callTool({ name: "browse_repo", arguments: {} });
  await h.snapshots.idle();
  const known = await findRepoByAlias(testDatabase.database, {
    host: "gh",
    owner: "acme",
    repo: "document-pack",
  });
  if (known === undefined) throw new Error("the pack was not resolved");
  const snapshot = await ensureSnapshot(
    testDatabase.database,
    { accountId: known.accountId, repoId: known.id },
    fixtureCommits().main,
    INDEX_VERSION,
    new Date(),
  );
  const scope: SnapshotScope = { accountId: known.accountId, snapshotId: snapshot.id };
  const embedded = await embedSnapshotSlice(
    {
      database: testDatabase.database,
      blobs: createBlobStore(testDatabase.database),
      embedder: embed.embedder,
      policy: { scope: "all", entitlements: allowEverything },
      lists: h.lists,
      usage: discardUsage,
      clock: { now: () => new Date() },
      logger: pino({ level: "silent" }),
    },
    { ...scope, repoId: known.id, commitSha: fixtureCommits().main, key: KEY, reason: "indexed" },
  );
  expect(embedded).toMatchObject({ status: "embedded", next: undefined });
});

afterAll(async () => {
  await client?.close();
  await testDatabase?.drop();
});

const search = async (query: string): Promise<string> =>
  textOf(await client.callTool({ name: "search_repo", arguments: { query } }));

const find = async (query: string, through: Harness = h) => {
  const response = await through.request(
    `/api/v1/find${ADDRESS}?query=${encodeURIComponent(query)}`,
  );
  const body = restFindSchema.parse(await response.json());
  if (body.status !== "ready") throw new Error(`not ready: ${body.status}`);
  return body;
};

describe("a search by words and by meaning", () => {
  it("finds by meaning what the words do not, names the section, and says so", async () => {
    // None of these words is in the handbook; the embedder knows what they mean.
    const text = await search("pardon tardy penalties");
    expect(text).toContain("document: docs/invoicing.md");
    expect(text).toMatch(
      / {3}- Invoicing > Late fees \(offset \d+, limit \d+\): A late fee is a fixed amount/,
    );
    expect(text).toContain("Ranked by words and meaning, the first results reranked.");

    const body = await find("pardon tardy penalties");
    expect(body.ranking).toEqual({ meaning: true, reranked: true });
    expect(body.items[0]).toMatchObject({ kind: "document", path: "docs/invoicing.md" });
    expect(embed.calls.filter((call) => call.as === "query").length).toBeGreaterThan(0);
  });

  it("fuses the words' results with the meaning's, a document's sections among them", async () => {
    const body = await find("waive a late fee");
    expect(body.ranking).toEqual({ meaning: true, reranked: true });
    const first = body.items[0];
    expect(first).toMatchObject({ kind: "document", path: "docs/invoicing.md" });
    if (first?.kind !== "document") throw new Error("a document");
    expect(first.sections?.[0]).toMatchObject({ heading: ["Invoicing", "Late fees"] });
    // A section the words matched keeps the excerpt of the words that matched: the window of the
    // line that holds the most of them, the earliest among equals.
    expect(first.sections?.[0]?.excerpt).toMatch(/^A late fee is a fixed amount/);
  });

  it("answers by the words alone when the embedder does not answer, and says so", async () => {
    embed.fail(new InferenceError("inference_busy", "the inference server is busy"));
    const text = await search("waive a late fee");
    expect(text).toContain("document: docs/invoicing.md");
    expect(text).toContain(
      "Ranked by words alone this time: the search by meaning did not answer.",
    );
    embed.fail(new InferenceError("inference_unreachable", "the inference server is away"));
    const body = await find("waive a late fee");
    expect(body.ranking).toEqual({ meaning: false, reranked: true });
    expect(body.items[0]).toMatchObject({ path: "docs/invoicing.md" });
  });

  it("lets a cache keep the answer of a pinned address only where the meaning answered", async () => {
    // A pinned public address may be kept a day: the commit never changes. An answer the
    // embedder did not reach this time is not the commit's, and is for no cache (ADR-0096).
    const pinned = `/api/v1/find${ADDRESS}@${fixtureCommits().main}?query=${encodeURIComponent("waive a late fee")}`;
    const whole = await h.request(pinned);
    expect(restFindSchema.parse(await whole.json())).toMatchObject({
      status: "ready",
      ranking: { meaning: true },
    });
    expect(whole.headers.get("cache-control")).toBe("public, max-age=86400");
    embed.fail(new InferenceError("inference_unreachable", "the inference server is away"));
    const alone = await h.request(pinned);
    expect(restFindSchema.parse(await alone.json())).toMatchObject({
      status: "ready",
      ranking: { meaning: false },
    });
    expect(alone.headers.get("cache-control")).toBe("no-store");
  });

  it("ranks a query of identifiers alone by its words, asking neither model, and says so (ADR-0079)", async () => {
    const asked = embed.calls.filter((call) => call.as === "query").length;
    const reranked = rerank.calls.length;
    const text = await search("JOB-4090");
    expect(text).toMatch(/^1\. document: docs\/api\/jobs\.md/m);
    expect(text).toContain(
      "Ranked by words alone: a query of numbers and names is matched as written.",
    );
    const body = await find("JOB-4090");
    expect(body.ranking).toEqual({ meaning: false, reranked: false, identifiers: true });
    expect(body.items[0]).toMatchObject({ kind: "document", path: "docs/api/jobs.md" });
    expect(embed.calls.filter((call) => call.as === "query").length).toBe(asked);
    expect(rerank.calls.length).toBe(reranked);

    // A question that begins with the identifier is answered by words and meaning, and the
    // document one of whose headings names the identifier stands first, whatever the reranker
    // makes of the rest.
    rerank.prefer("Release notes");
    const led = await find("JOB-4090 when two visits overlap");
    rerank.prefer(undefined);
    expect(led.ranking).toEqual({ meaning: true, reranked: true });
    expect(led.items[0]).toMatchObject({ kind: "document", path: "docs/api/jobs.md" });
    expect(led.items.map((item) => item.path)).toContain("docs/release-notes.md");
  });

  it("reranks the first results by the reranker's scores, and keeps the fused order when it does not answer", async () => {
    const fused = await find("reminder");
    const paths = fused.items.map((item) => item.path);
    expect(paths).toContain("docs/troubleshooting.md");
    expect(paths[0]).not.toBe("docs/troubleshooting.md");
    expect(rerank.calls.at(-1)?.length).toBeLessThanOrEqual(10);
    // A candidate is the document's title, the heading path and the start of its best section.
    expect(
      rerank.calls.at(-1)?.some((candidate) => candidate.startsWith("Troubleshooting > ")),
    ).toBe(true);

    rerank.prefer("Troubleshooting > ");
    const preferred = await find("reminder");
    expect(preferred.ranking).toEqual({ meaning: true, reranked: true });
    expect(preferred.items[0]).toMatchObject({ path: "docs/troubleshooting.md" });

    rerank.prefer(undefined);
    rerank.fail(new InferenceError("inference_unreachable", "the reranker is away"));
    const unranked = await find("reminder");
    expect(unranked.ranking).toEqual({ meaning: true, reranked: false });
    expect(unranked.items.map((item) => item.path)).toEqual(paths);
  });

  it("says how the pack is searched, on the mount and on connect", async () => {
    // The whole pack is embedded: the search uses the vectors, and the instructions say so.
    const response = await h.request(`/api/v1/mounts${ADDRESS}`);
    const mount = restMountSchema.parse(await response.json());
    expect(mount.index.status === "ready" ? mount.index.search : undefined).toEqual({
      meaning: true,
      embedding: { status: "complete" },
    });
    // The connection of the setup predates the embedding: a client connecting now is told.
    const fresh = await h.connect(ADDRESS);
    expect(fresh.getInstructions()).toContain(
      "search_repo matches words and meaning, so ask in your own words",
    );
    await fresh.close();
  });

  it("says nothing of meaning where a deployment has none", async () => {
    const plain = createHarness(testDatabase, { host });
    const other = await plain.connect(ADDRESS);
    const text = textOf(
      await other.callTool({ name: "search_repo", arguments: { query: "waive a late fee" } }),
    );
    expect(text).toContain("document: docs/invoicing.md");
    expect(text).not.toContain("Ranked by");
    const body = await find("waive a late fee", plain);
    expect(body.ranking).toBeUndefined();
    // The words answer alone, and the mount and the instructions say so.
    const response = await plain.request(`/api/v1/mounts${ADDRESS}`);
    const mount = restMountSchema.parse(await response.json());
    expect(mount.index.status === "ready" ? mount.index.search : undefined).toEqual({
      meaning: false,
      embedding: null,
    });
    expect(other.getInstructions()).toContain("search_repo matches original words");
    await other.close();
  });
});

describe("a search across the packs by words and by meaning", () => {
  const TIMED_OUT = "a statement of the search across packs ran out of its time";
  const SLOW = "a search across packs answered slowly";
  const asked = (): number => embed.calls.filter((call) => call.as === "query").length;
  const meaning = () => ({
    embedder: embed.embedder,
    reranker: rerank.reranker,
    rerankCandidates: 10,
    key: KEY,
  });
  const searchOf = (harness: Harness) => (query: string) =>
    harness.request(`/api/v1/search?query=${encodeURIComponent(query)}`);
  const timedOutOf = (harness: Harness) => (): unknown[] =>
    harness.logs.filter((line) => line.msg === TIMED_OUT).map((line) => line.statement);

  it("compares by meaning once the words have answered, and rests a comparison that ran out of its time", async () => {
    // No answer is kept, and a statement has a short time, so that the test waits for little.
    // The harness has a clock the test moves, for the rest of the comparison to end.
    let ahead = 0;
    const across = createHarness(testDatabase, {
      host,
      clock: { now: () => new Date(Date.now() + ahead) },
      hub: { ...HUB_DEFAULTS, cacheMs: 0, timeoutMs: 400 },
      meaning: meaning(),
    });
    const search = searchOf(across);
    const timedOut = timedOutOf(across);

    // A question in other words than the handbook's: found by meaning, across the packs.
    const before = asked();
    const found = await search("pardon tardy penalties");
    expect(found.status).toBe(200);
    const body = restSearchSchema.parse(await found.json());
    expect(body.ranking).toMatchObject({ meaning: true });
    expect(body.ranking?.words).toBeUndefined();
    expect(body.items[0]).toMatchObject({
      address: ADDRESS,
      item: { kind: "document", path: "docs/invoicing.md" },
    });
    expect(asked()).toBe(before + 1);

    // Identifiers alone are ranked by the words that found them, and the model is not asked.
    const coded = restSearchSchema.parse(await (await search("JOB-4090")).json());
    expect(coded.ranking).toEqual({ meaning: false, reranked: false, identifiers: true });
    expect(coded.items[0]).toMatchObject({ item: { kind: "document", path: "docs/api/jobs.md" } });
    expect(asked()).toBe(before + 1);

    // While nothing can read the entries, the count runs out of its time, and the comparison,
    // asked after it, runs out of its own: nothing answered, and the search says so. The log
    // names the two in the order they were asked.
    const release = await holdIndexEntries(testDatabase.database);
    try {
      const held = await search("waive a late fee");
      expect(held.status).toBe(503);
      expect(await held.json()).toMatchObject({ error: { code: "search.timeout" } });
      expect(asked()).toBe(before + 2);
      expect(timedOut()).toEqual(["count", "meaning"]);
    } finally {
      await release();
    }
    expect(across.logs.find((line) => line.msg === TIMED_OUT)).toMatchObject({
      level: 40,
      timeoutMs: 400,
      lexemes: 3,
    });

    // The comparison rests: the words answer alone, at once, and the model is not asked.
    const resting = await search("waive a late fee");
    expect(resting.status).toBe(200);
    expect(restSearchSchema.parse(await resting.json()).ranking).toMatchObject({ meaning: false });
    // An answer its meaning did not reach is for whoever asked, and for no cache (ADR-0096).
    expect(resting.headers.get("cache-control")).toBe("no-store");
    expect(asked()).toBe(before + 2);
    expect(timedOut()).toEqual(["count", "meaning"]);

    // Its rest over, it is asked again, and answers.
    ahead = 61_000;
    const rested = restSearchSchema.parse(await (await search("pardon tardy penalties")).json());
    expect(rested.ranking).toMatchObject({ meaning: true });
    expect(asked()).toBe(before + 3);
  });

  it("lets no cache keep an answer its meaning did not reach", async () => {
    const across = createHarness(testDatabase, {
      host,
      hub: { ...HUB_DEFAULTS, cacheMs: 300_000 },
      meaning: meaning(),
    });
    const search = searchOf(across);
    // The embedder does not answer this once: the words answer alone, and say so.
    embed.fail(new Error("the embedder is away"));
    const alone = await search("waive the late fees");
    expect(alone.status).toBe(200);
    expect(alone.headers.get("cache-control")).toBe("no-store");
    expect(restSearchSchema.parse(await alone.json()).ranking).toMatchObject({ meaning: false });
    // The search kept nothing of it: the same question is asked again, answered by both, and
    // that answer is one to keep (ADR-0096).
    const before = asked();
    const whole = await search("waive the late fees");
    expect(whole.headers.get("cache-control")).toContain("s-maxage=300");
    expect(restSearchSchema.parse(await whole.json()).ranking).toMatchObject({ meaning: true });
    expect(asked()).toBe(before + 1);
    await search("waive the late fees");
    expect(asked()).toBe(before + 1);
    // A query of identifiers is ranked by its words on purpose, and kept.
    const coded = await search("JOB-4090");
    expect(coded.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("answers by meaning alone when the words run out of their time, and lets no cache keep that", async () => {
    // An embedder that answers when the test lets it: the words run out of their time while
    // nothing can read the entries, and the comparison is asked once they can be read again.
    let hold: Promise<void> | undefined;
    const across = createHarness(testDatabase, {
      host,
      hub: { ...HUB_DEFAULTS, cacheMs: 300_000, timeoutMs: 400 },
      meaning: {
        ...meaning(),
        embedder: {
          ...embed.embedder,
          async embed(texts, as) {
            await hold;
            return embed.embedder.embed(texts, as);
          },
        },
      },
    });
    const timedOut = timedOutOf(across);
    const search = searchOf(across);
    /** Runs `ask` while the entries cannot be read, and lets them be read once the count ran out. */
    const withWordsOutOfTime = async <T>(counts: number, ask: () => Promise<T>): Promise<T> => {
      // The packs are listed before the entries are held: the list reads them as well.
      await search(`JOB-409${counts}`);
      let letGo: () => void = () => {};
      hold = new Promise((resolve) => {
        letGo = resolve;
      });
      const release = await holdIndexEntries(testDatabase.database);
      let released = false;
      try {
        const asking = ask();
        await expect.poll(timedOut).toEqual(new Array(counts).fill("count"));
        await release();
        released = true;
        letGo();
        return await asking;
      } finally {
        // Whatever failed above, the entries are let go, and the embedder answers again.
        if (!released) {
          await release();
        }
        letGo();
        hold = undefined;
      }
    };

    const answer = await withWordsOutOfTime(1, () => search("pardon tardy penalties"));
    // What the meaning found is the answer, said to be the meaning's alone, and for no cache.
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const partial = restSearchSchema.parse(await answer.json());
    expect(partial.ranking).toMatchObject({ meaning: true, words: false });
    expect(partial.items[0]).toMatchObject({
      address: ADDRESS,
      item: { kind: "document", path: "docs/invoicing.md" },
    });
    // The log says where the time of an answer that took longer than a statement may went.
    expect(across.logs.find((line) => line.msg === SLOW)).toMatchObject({
      level: 30,
      meaning: true,
      took: { count: expect.any(Number), meaning: expect.any(Number) },
    });

    // The search itself kept nothing of it either: the next who asks is answered by both, and
    // that answer is one to keep.
    const whole = await search("pardon tardy penalties");
    expect(whole.status).toBe(200);
    expect(whole.headers.get("cache-control")).toContain("s-maxage=300");
    const full = restSearchSchema.parse(await whole.json());
    expect(full.ranking).toMatchObject({ meaning: true });
    expect(full.ranking?.words).toBeUndefined();

    // The tool of the root says the same in its one line.
    const root = await across.connect("/");
    try {
      const told = await withWordsOutOfTime(2, () =>
        root.callTool({ name: "search_packs", arguments: { query: "pardon the tardy penalties" } }),
      );
      expect(textOf(told)).toContain("Ranked by meaning alone this time");
    } finally {
      await root.close();
    }
  });
});
