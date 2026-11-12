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
  const asked = (): number => embed.calls.filter((call) => call.as === "query").length;

  it("asks the meaning beside the words, and names in the log the statement that ran out of its time", async () => {
    // No answer is kept, and a statement has a short time, so that the test waits for little.
    const across = createHarness(testDatabase, {
      host,
      hub: { ...HUB_DEFAULTS, cacheMs: 0, timeoutMs: 400 },
      meaning: {
        embedder: embed.embedder,
        reranker: rerank.reranker,
        rerankCandidates: 10,
        key: KEY,
      },
    });
    const search = (query: string) =>
      across.request(`/api/v1/search?query=${encodeURIComponent(query)}`);

    // A question in other words than the handbook's: found by meaning, across the packs.
    const before = asked();
    const found = await search("pardon tardy penalties");
    expect(found.status).toBe(200);
    const body = restSearchSchema.parse(await found.json());
    expect(body.ranking).toMatchObject({ meaning: true });
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

    // While nothing can read the entries, the count runs out of its time. The search says so,
    // and the meaning had been asked for by then: the two do not wait for each other.
    const release = await holdIndexEntries(testDatabase.database);
    try {
      const held = await search("waive a late fee");
      expect(held.status).toBe(503);
      expect(await held.json()).toMatchObject({ error: { code: "search.timeout" } });
      expect(asked()).toBe(before + 2);
      await expect
        .poll(() =>
          across.logs
            .filter((line) => line.msg === TIMED_OUT)
            .map((line) => line.statement)
            .sort(),
        )
        .toEqual(["count", "meaning"]);
    } finally {
      await release();
    }
    expect(across.logs.find((line) => line.msg === TIMED_OUT)).toMatchObject({
      level: 40,
      timeoutMs: 400,
      lexemes: 3,
    });
    expect((await search("waive a late fee")).status).toBe(200);
  });
});
