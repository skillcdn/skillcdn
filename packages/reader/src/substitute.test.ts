import {
  type IndexEntry,
  type IndexLimits,
  type IndexOutcome,
  NO_LICENSE,
  parseAddress,
  type SnapshotIndex,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createMemoryIndex } from "./memory-index.js";
import type { MountContext } from "./mount.js";
import { Reader } from "./reader.js";

// A reader handed an index served in place of the mount's own commit's (ADR-0068) names the
// commit that index was built from in everything it answers, with the newest commit beside it,
// and the mount's own commit alone when it is handed no substitute.

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

const BODIES: Readonly<Record<string, string>> = {
  a: "# Fees\n\nA late fee is a fixed amount.\n",
  b: "# Guide\n\nHow to write ad copy.\n",
};

const index: SnapshotIndex = {
  entries: [
    entry({ path: "docs/a.md", blobSha: "a", title: "Fees" }),
    entry({ path: "docs/b.md", blobSha: "b", title: "Guide" }),
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

const LIMITS: IndexLimits = {
  maxTreeEntries: 1000,
  maxIndexedFiles: 1000,
  maxIndexedFileBytes: 1_000_000,
  maxIndexedTotalBytes: 10_000_000,
  maxReadableFileBytes: 1_000_000,
  maxArchiveBytes: 100_000_000,
};

const SERVED = "1".repeat(40);
const NEWEST = "2".repeat(40);

function mountOf(): MountContext {
  const parsed = parseAddress("/gh/acme/docs");
  if (!parsed.ok) throw new Error("bad address");
  return {
    address: parsed.value,
    commit: NEWEST,
    verified: true,
    visibility: "public",
    limits: {},
    repository: "acme/docs",
    description: undefined,
    sourceUrl: () => "https://example.test/source",
    rawUrl: () => "https://example.test/raw",
  };
}

const readerOf = (outcome: IndexOutcome) =>
  new Reader<MountContext>({ limits: LIMITS, index: async () => outcome });

describe("a reader handed an index served in place of the mount's own", () => {
  it("names the commit the index was built from in every answer, with the newest beside it", async () => {
    const newest = { commit: NEWEST, status: "failed", errorCode: "indexer.failed" } as const;
    const reader = readerOf({
      status: "ready",
      index: createMemoryIndex({ index, blobs }),
      substitute: { commit: SERVED, newest },
    });
    const mount = mountOf();

    const catalog = await reader.catalog(mount);
    expect(catalog.status === "ready" ? catalog.catalog.mount : undefined).toMatchObject({
      commit: SERVED,
      newest,
    });
    const browse = await reader.browse(mount, {}, 0);
    expect(browse.status === "ready" ? browse.result.mount : undefined).toMatchObject({
      commit: SERVED,
      newest,
    });
    const found = await reader.find(mount, { query: "guide" }, 0);
    expect(found.status === "ready" ? found.result.mount : undefined).toMatchObject({
      commit: SERVED,
      newest,
    });
    const overview = await reader.overview(mount, 10);
    expect(overview.status === "ready" ? overview.overview.mount : undefined).toMatchObject({
      commit: SERVED,
      newest,
    });
    const page = await reader.listSkills(mount, {}, 0);
    expect(page.status === "ready" ? page.result.mount : undefined).toMatchObject({
      commit: SERVED,
      newest,
    });
    // The mount handed in is left as it was: the caller's, at the commit it resolved.
    expect(mount.commit).toBe(NEWEST);
    expect(mount.newest).toBeUndefined();
  });

  it("names the mount's own commit and nothing more without a substitute", async () => {
    const reader = readerOf({ status: "ready", index: createMemoryIndex({ index, blobs }) });
    const mount = mountOf();
    const catalog = await reader.catalog(mount);
    expect(catalog.status === "ready" ? catalog.catalog.mount.commit : undefined).toBe(NEWEST);
    expect(catalog.status === "ready" ? catalog.catalog.mount.newest : null).toBeUndefined();
    const page = await reader.listSkills(mount, {}, 0);
    expect(page.status === "ready" ? page.result.mount.newest : null).toBeUndefined();
  });
});
