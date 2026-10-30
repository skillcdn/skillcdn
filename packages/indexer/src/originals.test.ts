import {
  type BlobStore,
  decodeText,
  type GitHost,
  GitHostError,
  type IndexLimits,
  parseRepoPath,
  parseSearchVector,
  type RepoPath,
  type TreeEntry,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { buildSnapshotIndex } from "./build-index.js";
import { gitBlobHash } from "./git-hash.js";
import { INDEX_LIMIT_DEFAULTS } from "./limits.js";

// A pack that carries its originals and its pictures (ADR-0076, ADR-0077): what the reading
// rules say of a document's links, pictures and sources, how the headings of a document weigh,
// and how the bodies are fetched when the pack is mostly bytes the index never reads.

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
}

interface Host {
  readonly gitHost: Pick<GitHost, "getTree" | "readBlob" | "readArchive">;
  readonly blobStore: BlobStore;
  readonly calls: { archive: number; blobs: number };
  readonly stored: Map<string, Uint8Array>;
}

/** A git host over files in memory, with the archive transport when asked for. */
function hostOf(files: Record<string, string | Uint8Array>, archive: boolean): Host {
  const bytes = new Map<string, Uint8Array>();
  const entries: TreeEntry[] = Object.entries(files).map(([name, body]) => {
    const data = typeof body === "string" ? new TextEncoder().encode(body) : body;
    const hash = gitBlobHash(data);
    bytes.set(hash, data);
    return { path: path(name), hash, size: data.byteLength, type: "file" };
  });
  const calls = { archive: 0, blobs: 0 };
  const stored = new Map<string, Uint8Array>();
  return {
    calls,
    stored,
    gitHost: {
      async getTree() {
        return { entries, truncated: false };
      },
      async readBlob(_coordinates, hash) {
        calls.blobs += 1;
        const data = bytes.get(hash);
        if (data === undefined) throw new GitHostError("not_found", "unavailable test file");
        return data;
      },
      ...(archive
        ? {
            async *readArchive(_coordinates, _commit, request) {
              calls.archive += 1;
              for (const entry of entries) {
                const data = bytes.get(entry.hash);
                if (data !== undefined && request.wants(entry.path, entry.size)) {
                  yield { path: entry.path, bytes: data };
                }
              }
            },
          }
        : {}),
    },
    blobStore: {
      async read(hash) {
        const body = stored.get(hash);
        return body === undefined ? undefined : decodeText(body);
      },
      async readBytes(hash) {
        return stored.get(hash);
      },
      async write(hash, body) {
        stored.set(hash, body);
      },
      async missing(hashes) {
        return new Set(hashes.filter((hash) => !stored.has(hash)));
      },
    },
  };
}

async function index(host: Host, limits: Partial<IndexLimits> = {}) {
  const result = await buildSnapshotIndex({
    gitHost: host.gitHost,
    blobStore: host.blobStore,
    coordinates: { host: "gh", owner: "acme", repo: "manual" },
    commit: "a".repeat(40),
    limits: { ...INDEX_LIMIT_DEFAULTS, ...limits },
    signal: new AbortController().signal,
  });
  return { ...result, byPath: new Map(result.entries.map((entry) => [entry.path, entry])) };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MANIFEST = "---\nname: The manual\ndescription: A manual.\ndocuments:\n  - docs\n---\n";

describe("what the reading rules say of a document's links, pictures and originals", () => {
  it("reports a dead link, a picture without words and a missing picture, once per file and kind", async () => {
    const result = await index(
      hostOf(
        {
          "SKILLCDN.md": MANIFEST,
          "docs/README.md": "# The manual\n\n- [Chapter 3](ch3.md)\n",
          "docs/ch3.md": [
            "---",
            "title: Chapter 3",
            "source: sources/manual.pdf",
            "---",
            "# Chapter 3",
            "",
            "![Block diagram of the interface](images/interface.png)",
            "![](images/placeholder.png) ![](images/other.png)",
            "![A missing figure](images/missing.png)",
            "See [the next chapter](ch4.md) and [the original](sources/manual.pdf).",
          ].join("\n"),
          "docs/images/interface.png": PNG,
          "docs/images/placeholder.png": PNG,
          "docs/images/other.png": PNG,
          "docs/sources/manual.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
        false,
      ),
    );
    expect(result.diagnostics).toEqual([
      {
        path: "docs/ch3.md",
        code: "link_missing",
        message: "a link names no file of the repository (ch4.md)",
      },
      {
        path: "docs/ch3.md",
        code: "image_missing",
        message: "an image names no file of the repository (images/missing.png)",
      },
      {
        path: "docs/ch3.md",
        code: "image_without_alt",
        message:
          "2 images have no alternative text (images/placeholder.png, images/other.png): an agent reads a picture by the words the document gives it",
      },
    ]);
    // The originals and the pictures are files of the pack, listed and never searched.
    expect(result.byPath.get("docs/sources/manual.pdf")).toMatchObject({
      kind: "other",
      visible: true,
      searchable: false,
    });
    expect(result.byPath.get("docs/images/interface.png")?.visible).toBe(true);
  });

  it("reports an original that is not there, and takes a title or a URL for text", async () => {
    const result = await index(
      hostOf(
        {
          "SKILLCDN.md": MANIFEST,
          "docs/ch3.md":
            "---\nsource:\n  - sources/gone.pdf\n  - Vendor manual, rev. 3\n  - https://example.com/spec\n---\n# Chapter 3\n",
        },
        false,
      ),
    );
    expect(result.diagnostics).toEqual([
      {
        path: "docs/ch3.md",
        code: "source_missing",
        message: "source names sources/gone.pdf, which is not a file of the repository",
      },
    ]);
  });

  it("tells a skill, and not a document, of a reference to a file that is not text", async () => {
    const result = await index(
      hostOf(
        {
          "SKILLCDN.md": MANIFEST,
          "skills/draw/SKILL.md":
            "---\nname: draw\ndescription: Draws.\n---\n# Draw\n\nUse [the model](assets/model.bin) and [the notes](references/notes.md).\n",
          "skills/draw/assets/model.bin": new Uint8Array([0, 1, 2, 3]),
          "skills/draw/references/notes.md": "# Notes\n\nSee [the weights](../assets/model.bin).\n",
          "docs/ch3.md":
            "# Chapter 3\n\nThe [original](sources/manual.pdf) is beside this chapter.\n",
          "docs/sources/manual.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
        false,
      ),
    );
    expect(result.diagnostics).toEqual([
      {
        path: "skills/draw/SKILL.md",
        code: "reference_not_text",
        message:
          "a reference is not to a text file (assets/model.bin): a skill works from Markdown and small JSON, and an agent can only fetch such a file from its source",
      },
      {
        path: "skills/draw/references/notes.md",
        code: "reference_not_text",
        message:
          "a reference is not to a text file (../assets/model.bin): a skill works from Markdown and small JSON, and an agent can only fetch such a file from its source",
      },
    ]);
  });

  it("weighs the headings of a document with the words of its path, above its body", async () => {
    const result = await index(
      hostOf(
        {
          "SKILLCDN.md": MANIFEST,
          "docs/items.md":
            "# Items\n\nAn introduction.\n\n## Data Item I048/020\n\nThe target report descriptor.\n",
        },
        false,
      ),
    );
    const vector = parseSearchVector(result.byPath.get("docs/items.md")?.search ?? "");
    const code = vector.get("i048/020");
    expect(code?.map((position) => position.weight)).toEqual(["C", "D"]);
    expect(vector.get("descriptor")?.map((position) => position.weight)).toEqual(["D"]);
  });
});

describe("how the bodies are fetched for a pack that carries its originals (ADR-0077)", () => {
  const pages = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `docs/page-${index}.md`,
      `# Page ${index}\n\nThe text of page ${index}.\n`,
    ]),
  );

  it("takes one archive for a pack of many small files, before any round", async () => {
    const host = hostOf({ "SKILLCDN.md": MANIFEST, ...pages }, true);
    const result = await index(host);
    expect(host.calls.archive).toBe(1);
    expect(host.calls.blobs).toBe(0);
    expect(result.entries.filter((entry) => entry.searchable).length).toBe(12);
  });

  it("fetches file by file when the archive would mostly be originals the index never reads", async () => {
    const original = new Uint8Array(40 * 1024 * 1024);
    const host = hostOf(
      { "SKILLCDN.md": MANIFEST, ...pages, "docs/sources/manual.pdf": original },
      true,
    );
    const result = await index(host);
    expect(host.calls.archive).toBe(0);
    // The manifest and the twelve pages, each once; the original never.
    expect(host.calls.blobs).toBe(13);
    expect(host.stored.has(gitBlobHash(original))).toBe(false);
    expect(result.byPath.get("docs/sources/manual.pdf")?.visible).toBe(true);
  });

  it("fetches nothing twice: what the store holds is not asked for again", async () => {
    const files = { "SKILLCDN.md": MANIFEST, ...pages };
    const first = hostOf(files, true);
    await index(first);
    const second = hostOf(files, true);
    for (const [hash, bytes] of first.stored) second.stored.set(hash, bytes);
    await index(second);
    expect(second.calls.archive).toBe(0);
    expect(second.calls.blobs).toBe(0);
  });
});
