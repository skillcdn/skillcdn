import {
  type IndexEntry,
  type IndexLimits,
  NO_LICENSE,
  parseAddress,
  queryLexemes,
  queryWeights,
  ROOT_PATH,
  type SnapshotIndex,
  searchVectorOf,
  serializeSearchVector,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createMemoryIndex } from "./memory-index.js";
import type { MountContext } from "./mount.js";
import { Reader } from "./reader.js";

// Each word of a query weighs by its rarity among the entries searched (ADR-0069): the memory
// index counts how many of its entries hold each word, and ranks with the weights the reader
// makes of the counts, so that a code one document holds outranks a word every document repeats.

// The common word in two short documents, the rare one in a longer document.
const BODIES: Readonly<Record<string, string>> = {
  a: "VDS",
  b: "4205 standard list",
  c: "VDS other",
};

const entry = (path: string, blobSha: string): IndexEntry => ({
  path,
  kind: "markdown",
  size: 10,
  blobSha,
  skillDir: undefined,
  name: undefined,
  title: undefined,
  description: undefined,
  frontMatter: undefined,
  searchable: true,
  visible: true,
  search: serializeSearchVector(searchVectorOf([{ weight: "D", text: BODIES[blobSha] ?? "" }])),
});

const index: SnapshotIndex = {
  entries: [entry("docs/a.md", "a"), entry("docs/b.md", "b"), entry("other/c.md", "c")],
  truncated: false,
  indexedBytes: 0,
  diagnostics: [],
  license: NO_LICENSE,
  version: 1,
};

const blobs = {
  read: async (hash: string) => BODIES[hash],
  readBytes: async (hash: string) => {
    const text = BODIES[hash];
    return text === undefined ? undefined : new TextEncoder().encode(text);
  },
};

const LIMITS: IndexLimits = {
  maxTreeEntries: 1000,
  maxIndexedFiles: 1000,
  maxIndexedFileBytes: 1_000_000,
  maxIndexedTotalBytes: 10_000_000,
  maxReadableFileBytes: 1_000_000,
  maxArchiveBytes: 100_000_000,
};

function mountOf(): MountContext {
  const parsed = parseAddress("/gh/acme/docs");
  if (!parsed.ok) throw new Error("bad address");
  return {
    address: parsed.value,
    commit: "0".repeat(40),
    verified: true,
    visibility: "public",
    limits: {},
    repository: "acme/docs",
    description: undefined,
    sourceUrl: () => "https://example.test/source",
    rawUrl: () => "https://example.test/raw",
  };
}

describe("the words of a query weighed by their rarity", () => {
  const memory = createMemoryIndex({ index, blobs });
  const lexemes = queryLexemes("VDS 4205");

  it("counts the entries under the path, and how many hold each word", async () => {
    expect(await memory.store.frequencies?.(ROOT_PATH, lexemes)).toEqual({
      total: 3,
      counts: [2, 1],
    });
    const docs = parseAddress("/gh/acme/docs/docs");
    if (!docs.ok) throw new Error("bad address");
    expect(await memory.store.frequencies?.(docs.value.path, lexemes)).toEqual({
      total: 2,
      counts: [1, 1],
    });
    expect(await memory.store.frequencies?.(ROOT_PATH, [])).toEqual({ total: 3, counts: [] });
  });

  it("ranks the document that holds the rare word above the one that holds the common word, with weights", async () => {
    // Every word the same: the shorter document wins.
    const plain = await memory.store.search(ROOT_PATH, lexemes);
    expect(plain.map((item) => item.path)).toEqual(["docs/a.md", "other/c.md", "docs/b.md"]);
    const counted = await memory.store.frequencies?.(ROOT_PATH, lexemes);
    if (counted === undefined) throw new Error("the memory index counts");
    const weighed = await memory.store.search(
      ROOT_PATH,
      lexemes,
      queryWeights(counted.total, counted.counts),
    );
    expect(weighed.map((item) => item.path)).toEqual(["docs/b.md", "docs/a.md", "other/c.md"]);
  });

  it("is what the reader searches by", async () => {
    const reader = new Reader<MountContext>({
      limits: LIMITS,
      index: async () => ({ status: "ready", index: memory }),
    });
    const found = await reader.find(mountOf(), { query: "VDS 4205" }, 0);
    expect(found.status).toBe("ready");
    if (found.status !== "ready") return;
    expect(found.result.items.map((item) => item.path)).toEqual([
      "docs/b.md",
      "docs/a.md",
      "other/c.md",
    ]);
  });
});

describe("a skill among the documents the words find", () => {
  // One word each, in a field that weighs less from one document to the next, and the skill
  // last: it holds both words in a longer body.
  const fields: readonly (readonly ["A" | "B" | "C" | "D", string])[] = [
    ["A", "tariff"],
    ["B", "tariff levy"],
    ["C", "tariff levy"],
    ["D", "tariff levy"],
  ];
  const documents = fields.map(
    ([weight, text], at): IndexEntry => ({
      ...entry(`docs/${at + 1}.md`, `doc-${at + 1}`),
      search: serializeSearchVector(searchVectorOf([{ weight, text }])),
    }),
  );
  const skill: IndexEntry = {
    ...entry("skills/duties/SKILL.md", "skill"),
    kind: "skill",
    skillDir: "skills/duties",
    name: "duties",
    description: "Works out what is owed.",
    search: serializeSearchVector(
      searchVectorOf([{ weight: "D", text: "tariff levy and six more words of a body" }]),
    ),
  };
  const memory = createMemoryIndex({
    index: { ...index, entries: [...documents, skill] },
    blobs,
  });
  const reader = new Reader<MountContext>({
    limits: LIMITS,
    index: async () => ({ status: "ready", index: memory }),
  });
  const found = async (query: string): Promise<(string | undefined)[]> => {
    const answer = await reader.find(mountOf(), { query }, 0);
    if (answer.status !== "ready") throw new Error("not ready");
    return answer.result.items.map((item) => item.path);
  };

  it("is ranked by the words as a document is", async () => {
    const byWords = await memory.store.search(ROOT_PATH, queryLexemes("tariff"));
    expect(byWords.map((item) => item.path)).toEqual([
      "docs/1.md",
      "docs/2.md",
      "docs/3.md",
      "docs/4.md",
      "skills/duties/SKILL.md",
    ]);
  });

  it("passes the documents up to three places ahead of it where the results are put in order, and no more", async () => {
    // Three documents ahead by the words: the skill stands first.
    expect(await found("levy")).toEqual([
      "skills/duties/SKILL.md",
      "docs/2.md",
      "docs/3.md",
      "docs/4.md",
    ]);
    // Four ahead: it passes three of them.
    expect(await found("tariff")).toEqual([
      "docs/1.md",
      "skills/duties/SKILL.md",
      "docs/2.md",
      "docs/3.md",
      "docs/4.md",
    ]);
  });
});

describe("a search while the embedding of the index goes on", () => {
  const embedder = {
    embed: async (texts: readonly string[]) => ({
      vectors: texts.map(() => Float32Array.from([1, 0])),
      tokens: 0,
    }),
  };
  const section = { heading: [], offset: 0, length: 3, section: 0 };
  const readerOver = (embedded: readonly string[]) =>
    new Reader<MountContext>({
      limits: LIMITS,
      index: async () => ({
        status: "ready",
        index: createMemoryIndex({
          index,
          blobs,
          vectors: {
            sectionsOf: (blobSha) =>
              embedded.includes(blobSha)
                ? [{ ...section, vector: Float32Array.from([1, 0]) }]
                : undefined,
          },
        }),
      }),
      meaning: { embedder },
    });

  it("says how many of the documents have their vectors so far, and nothing once all have", async () => {
    const partly = await readerOver(["a"]).find(mountOf(), { query: "standard list" }, 0);
    if (partly.status !== "ready") throw new Error("not ready");
    expect(partly.result.ranking).toEqual({
      meaning: true,
      reranked: false,
      embedding: { embedded: 1, total: 3 },
    });
    const whole = await readerOver(["a", "b", "c"]).find(mountOf(), { query: "standard list" }, 0);
    if (whole.status !== "ready") throw new Error("not ready");
    expect(whole.result.ranking).toEqual({ meaning: true, reranked: false });
  });

  it("ranks a query of identifiers alone by its words, with no word of the embedding (ADR-0079)", async () => {
    const found = await readerOver(["a"]).find(mountOf(), { query: "4205" }, 0);
    if (found.status !== "ready") throw new Error("not ready");
    expect(found.result.ranking).toEqual({ meaning: false, reranked: false, identifiers: true });
    expect(found.result.items.map((item) => item.path)).toEqual(["docs/b.md"]);
  });
});
