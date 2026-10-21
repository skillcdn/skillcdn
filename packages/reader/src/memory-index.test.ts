import {
  type Embedder,
  type IndexEntry,
  type IndexLimits,
  NO_LICENSE,
  parseAddress,
  ROOT_PATH,
  type SnapshotIndex,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createMemoryIndex, type MemorySectionVector } from "./memory-index.js";
import type { MountContext } from "./mount.js";
import { Reader } from "./reader.js";

// An index in memory with the vectors of its sections (ADR-0064): it answers a search by meaning
// over them as a deployment's database does, counts how far their embedding has come as the
// worker counts it, and the reader says how the mount is searched from that.

const entry = (patch: Partial<IndexEntry> & Pick<IndexEntry, "path" | "blobSha">): IndexEntry => ({
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
});

const PRIVATE_MANIFEST = "---\nname: Private notes\nsearch:\n  meaning: false\n---\n";
const BODIES: Readonly<Record<string, string>> = {
  a: "# Fees\n\nA late fee is a fixed amount.\n",
  b: "# Guide\n\nHow to write ad copy.\n",
  m: PRIVATE_MANIFEST,
  c: "# Notes\n\nThe secret recipe.\n",
};

const index: SnapshotIndex = {
  entries: [
    entry({ path: "docs/a.md", blobSha: "a", title: "Fees" }),
    entry({ path: "docs/b.md", blobSha: "b", title: "Guide" }),
    entry({
      path: "docs/private/SKILLCDN.md",
      blobSha: "m",
      kind: "manifest",
      searchable: false,
      frontMatter: { metadata: {}, warnings: [], search: { meaning: false } },
    }),
    entry({ path: "docs/private/c.md", blobSha: "c", title: "Notes" }),
    entry({ path: "docs/data.json", blobSha: "j", kind: "json" }),
  ],
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

const vectorOf = (heading: string, numbers: number[]): MemorySectionVector => ({
  heading: [heading],
  offset: 0,
  length: 10,
  section: 0,
  vector: Float32Array.from(numbers),
});

/** The vectors of some bodies, by hash, which the test fills in as the embedding goes. */
function vectorsOf(known: Record<string, MemorySectionVector[]>) {
  return { sectionsOf: (blobSha: string) => known[blobSha] };
}

const LIMITS: IndexLimits = {
  maxTreeEntries: 1000,
  maxIndexedFiles: 1000,
  maxIndexedFileBytes: 1_000_000,
  maxIndexedTotalBytes: 10_000_000,
  maxReadableFileBytes: 1_000_000,
  maxArchiveBytes: 100_000_000,
};

function mountOf(): MountContext {
  const parsed = parseAddress("/local/acme/docs");
  if (!parsed.ok) throw new Error("bad address");
  return {
    address: parsed.value,
    commit: "0".repeat(40),
    verified: true,
    visibility: "private",
    limits: {},
    repository: "acme/docs",
    description: undefined,
    sourceUrl: () => "file:///acme/docs",
    rawUrl: () => "file:///acme/docs",
  };
}

const embedder: Pick<Embedder, "embed"> = {
  async embed(texts) {
    return { vectors: texts.map(() => Float32Array.from([1, 0, 0, 0])), tokens: 0 };
  },
};

describe("an index in memory with vectors", () => {
  it("answers a search by meaning over the vectors it has, nearest first and in path order on a tie", async () => {
    const known = {
      a: [vectorOf("Fees", [1, 0, 0, 0]), vectorOf("Late fee", [0.8, 0.6, 0, 0])],
      b: [vectorOf("Guide", [0, 1, 0, 0])],
      // Another model's vectors are not compared.
      c: [vectorOf("Notes", [1, 0])],
    };
    const memory = createMemoryIndex({ index, blobs, vectors: vectorsOf(known) });
    const found = await memory.store.searchByMeaning?.(
      ROOT_PATH,
      Float32Array.from([1, 0, 0, 0]),
      10,
    );
    expect(found?.map((match) => [match.path, match.heading[0], match.similarity])).toEqual([
      ["docs/a.md", "Fees", 1],
      ["docs/a.md", "Late fee", expect.closeTo(0.8, 5)],
      ["docs/b.md", "Guide", 0],
    ]);
    expect(
      await memory.store.searchByMeaning?.(ROOT_PATH, Float32Array.from([1, 0, 0, 0]), 1),
    ).toHaveLength(1);
    // Without vectors there is no search by meaning at all.
    expect(createMemoryIndex({ index, blobs }).store.searchByMeaning).toBeUndefined();
  });

  it("counts the embedding as the worker counts it: findable documents a manifest does not keep out", async () => {
    const known: Record<string, MemorySectionVector[]> = {};
    const memory = createMemoryIndex({ index, blobs, vectors: vectorsOf(known) });
    expect(await memory.store.embeddingProgress?.()).toEqual({
      status: "in_progress",
      embedded: 0,
      total: 2,
    });
    known.a = [vectorOf("Fees", [1, 0, 0, 0])];
    expect(await memory.store.embeddingProgress?.()).toEqual({
      status: "in_progress",
      embedded: 1,
      total: 2,
    });
    // The notes under the manifest that keeps them to the words count for nothing.
    known.c = [vectorOf("Notes", [1, 0, 0, 0])];
    known.b = [vectorOf("Guide", [0, 1, 0, 0])];
    expect(await memory.store.embeddingProgress?.()).toEqual({ status: "complete" });
  });

  it("tells the reader how the mount is searched, which the catalog and the overview carry", async () => {
    const known: Record<string, MemorySectionVector[]> = {};
    const memory = createMemoryIndex({ index, blobs, vectors: vectorsOf(known) });
    const reader = new Reader<MountContext>({
      limits: LIMITS,
      index: async () => ({ status: "ready", index: memory }),
      meaning: { embedder },
    });
    const mount = mountOf();
    const before = await reader.catalog(mount);
    expect(before.status === "ready" ? before.catalog.search : undefined).toEqual({
      meaning: false,
      embedding: { status: "in_progress", embedded: 0, total: 2 },
    });
    known.a = [vectorOf("Fees", [1, 0, 0, 0])];
    const during = await reader.overview(mount, 10);
    expect(during.status === "ready" ? during.overview.search : undefined).toEqual({
      meaning: true,
      embedding: { status: "in_progress", embedded: 1, total: 2 },
    });
    // A reader without an embedder has nothing to say of meaning, vectors or not.
    const words = new Reader<MountContext>({
      limits: LIMITS,
      index: async () => ({ status: "ready", index: memory }),
    });
    const plain = await words.catalog(mount);
    expect(plain.status === "ready" ? plain.catalog.search : null).toBeUndefined();
  });
});
