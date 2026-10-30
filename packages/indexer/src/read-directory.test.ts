import { mkdir, mkdtemp, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRepoPath, type RepoPath } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { INDEX_LIMIT_DEFAULTS } from "./limits.js";
import { bytesOf, openWorkingTreeFile, readDirectory, readWorkingTree } from "./read-directory.js";

// A working tree read with the pictures and the originals a pack carries (ADR-0077): listed by a
// stand-in hash and read from disk when something asks for their bytes, never with the tree.

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

async function pack(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillcdn-tree-"));
  await mkdir(join(root, "docs", "images"), { recursive: true });
  await mkdir(join(root, "docs", "sources"), { recursive: true });
  await mkdir(join(root, "skills", "draw", "assets"), { recursive: true });
  await writeFile(
    join(root, "SKILLCDN.md"),
    "---\nname: Manual\ndescription: A manual.\ndocuments:\n  - docs\n---\n",
  );
  await writeFile(join(root, "docs", "ch3.md"), "# Chapter 3\n\n![A figure](images/a.png)\n");
  await writeFile(join(root, "docs", "images", "a.png"), PNG);
  await writeFile(join(root, "docs", "sources", "manual.pdf"), "%PDF-1.7 not really");
  await writeFile(
    join(root, "skills", "draw", "SKILL.md"),
    "---\nname: draw\ndescription: Draws.\n---\n# Draw\n",
  );
  await writeFile(join(root, "skills", "draw", "assets", "icon.png"), PNG);
  return root;
}

describe("reading a working tree", () => {
  it("reads the text files with the tree, and lists the rest to be read when asked", async () => {
    const root = await pack();
    const { files } = await readWorkingTree(root, INDEX_LIMIT_DEFAULTS);
    const byPath = new Map(files.map((file) => [file.entry.path, file]));
    expect(byPath.get(path("docs/ch3.md"))?.bytes).toBeDefined();
    expect(byPath.get(path("SKILLCDN.md"))?.bytes).toBeDefined();
    const picture = byPath.get(path("docs/images/a.png"));
    if (picture === undefined) throw new Error("the picture was not listed");
    expect(picture.bytes).toBeUndefined();
    expect(picture.entry.size).toBe(PNG.byteLength);
    expect(await bytesOf(picture)).toEqual(PNG);
    expect(byPath.get(path("docs/sources/manual.pdf"))?.bytes).toBeUndefined();
  });

  it("gives a file it does not read a stand-in hash that changes with the file", async () => {
    const root = await pack();
    const before = await readWorkingTree(root, INDEX_LIMIT_DEFAULTS);
    const hashOf = (files: typeof before.files): string | undefined =>
      files.find((file) => file.entry.path === "docs/images/a.png")?.entry.hash;
    expect(hashOf((await readWorkingTree(root, INDEX_LIMIT_DEFAULTS)).files)).toBe(
      hashOf(before.files),
    );
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "docs", "images", "a.png"), later, later);
    expect(hashOf((await readWorkingTree(root, INDEX_LIMIT_DEFAULTS)).files)).not.toBe(
      hashOf(before.files),
    );
  });

  it("serves the bytes of a listed file through the git host in memory, for a skill's files among them", async () => {
    const root = await pack();
    const read = await readDirectory({ directory: root, limits: INDEX_LIMIT_DEFAULTS });
    const icon = read.index.entries.find((entry) => entry.path === "skills/draw/assets/icon.png");
    // The file of a listed skill was fetched for its digest, through the lazy read.
    expect(icon?.digest).toBeDefined();
    const picture = read.index.entries.find((entry) => entry.path === "docs/images/a.png");
    expect(picture?.digest).toBeUndefined();
    expect(await read.readBlob(picture?.blobSha ?? "", 1024)).toEqual(PNG);
    await expect(read.readBlob(picture?.blobSha ?? "", 4)).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(read.readBlob("0".repeat(40), 1024)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("opens a file of the tree to be sent as it is, and nothing outside it or through a link", async () => {
    const root = await pack();
    const opened = await openWorkingTreeFile(root, path("docs/sources/manual.pdf"));
    expect(opened?.size).toBe("%PDF-1.7 not really".length);
    const chunks: Uint8Array[] = [];
    for await (const chunk of opened?.body() ?? []) chunks.push(chunk);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("%PDF-1.7 not really");
    expect(await openWorkingTreeFile(root, path("docs"))).toBeUndefined();
    expect(await openWorkingTreeFile(root, path("docs/missing.pdf"))).toBeUndefined();
    const outside = await mkdtemp(join(tmpdir(), "skillcdn-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    try {
      await symlink(join(outside, "secret.txt"), join(root, "docs", "link.txt"), "file");
      await symlink(outside, join(root, "docs", "elsewhere"), "junction");
    } catch {
      // Without the right to link, there is nothing to follow.
      return;
    }
    expect(await openWorkingTreeFile(root, path("docs/link.txt"))).toBeUndefined();
    expect(await openWorkingTreeFile(root, path("docs/elsewhere/secret.txt"))).toBeUndefined();
  });
});
