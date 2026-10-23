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
