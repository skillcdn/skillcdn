import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GitHost, GitHostError, type IndexLimits, type RepoCoordinates } from "@skillcdn/core";
import { INDEX_LIMIT_DEFAULTS } from "@skillcdn/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDirectoryHost, routeGitHosts } from "./directory-host.js";

// The git-host port over a directory of packs (ADR-0071): what a pack is, what its commit is,
// and that nothing outside the root is ever a pack.

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "skillcdn-directory-host-"));
  await mkdir(join(root, "acme", "handbook", "docs"), { recursive: true });
  await writeFile(join(root, "acme", "handbook", "README.md"), "# Handbook\n");
  await writeFile(join(root, "acme", "handbook", "docs", "leave.md"), "# Leave\n\nTen days.\n");
  await mkdir(join(root, "acme", "empty"), { recursive: true });
  await writeFile(join(root, "acme", "notes.md"), "a file, not a pack\n");
  await mkdir(join(root, ".hidden", "pack"), { recursive: true });
  await writeFile(join(root, ".hidden", "pack", "README.md"), "# Hidden\n");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const HANDBOOK: RepoCoordinates = { host: "local", owner: "acme", repo: "handbook" };
const limits: IndexLimits = INDEX_LIMIT_DEFAULTS;

async function kindOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "resolved";
  } catch (error) {
    return error instanceof GitHostError ? error.kind : "other";
  }
}

describe("a directory of packs as a git host", () => {
  it("answers a pack as a public repository named after its directories, at the hash of its tree", async () => {
    const host = createDirectoryHost({ root, limits });
    const repository = await host.getRepository(HANDBOOK);
    expect(repository).toEqual({
      hostRepoId: "acme/handbook",
      owner: { hostAccountId: "acme", login: "acme", kind: "organization" },
      name: "handbook",
      defaultBranch: "working",
      description: undefined,
      visibility: "public",
    });
    const commit = await host.resolveRef(HANDBOOK, undefined);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    // The same files are the same commit, on a host made later as well.
    expect(await createDirectoryHost({ root, limits }).resolveRef(HANDBOOK, undefined)).toBe(
      commit,
    );

    const tree = await host.getTree(HANDBOOK, commit);
    expect(tree.truncated).toBe(false);
    expect(tree.entries.map((entry) => entry.path)).toEqual(["README.md", "docs/leave.md"]);
    const leave = tree.entries.find((entry) => entry.path === "docs/leave.md");
    if (leave === undefined) throw new Error("no such entry");
    expect(new TextDecoder().decode(await host.readBlob(HANDBOOK, leave.hash, 1024))).toBe(
      "# Leave\n\nTen days.\n",
    );
    expect(await kindOf(host.readBlob(HANDBOOK, leave.hash, 4))).toBe("invalid");
    expect(await kindOf(host.readBlob(HANDBOOK, "0".repeat(40), 1024))).toBe("not_found");

    // The archive is the same bytes in one pass, for what is wanted and within the bound.
    const archive = host.readArchive;
    if (archive === undefined) throw new Error("the host has no archive");
    const files: string[] = [];
    for await (const file of archive(HANDBOOK, commit, {
      wants: (file) => file !== "README.md",
      maxArchiveBytes: 1024,
    })) {
      files.push(file.path);
    }
    expect(files).toEqual(["docs/leave.md"]);
  });

  it("is a changed commit when a file changes, and the tree of the moment before cannot be read any more", async () => {
    const host = createDirectoryHost({ root, limits });
    const own = join(root, "acme", "changing");
    await mkdir(own, { recursive: true });
    await writeFile(join(own, "README.md"), "# One\n");
    const changing: RepoCoordinates = { host: "local", owner: "acme", repo: "changing" };
    const first = await host.resolveRef(changing, undefined);
    await writeFile(join(own, "README.md"), "# Two\n");
    const second = await host.resolveRef(changing, undefined);
    expect(second).not.toBe(first);
    expect(await kindOf(host.getTree(changing, first))).toBe("transient");
    expect((await host.getTree(changing, second)).entries).toHaveLength(1);
  });

  it("knows nothing by any other name, in the same words", async () => {
    const host = createDirectoryHost({ root, limits });
    const nothing = async (coordinates: RepoCoordinates) => kindOf(host.getRepository(coordinates));
    expect(await nothing({ host: "local", owner: "acme", repo: "missing" })).toBe("not_found");
    // A file is not a pack; an empty directory is one with nothing in it.
    expect(await nothing({ host: "local", owner: "acme", repo: "notes.md" })).toBe("not_found");
    expect(await kindOf(host.getRepository({ host: "local", owner: "acme", repo: "empty" }))).toBe(
      "resolved",
    );
    // Nothing outside the root, and nothing hidden, whatever the name tries.
    expect(await nothing({ host: "local", owner: "..", repo: "handbook" })).toBe("not_found");
    expect(await nothing({ host: "local", owner: "acme", repo: "../.hidden" })).toBe("not_found");
    expect(await nothing({ host: "local", owner: ".hidden", repo: "pack" })).toBe("not_found");
    expect(await nothing({ host: "local", owner: "acme/handbook", repo: "docs" })).toBe(
      "not_found",
    );
    // Not a git host, whatever it is asked about; and a working tree has no refs.
    expect(await nothing({ host: "gh", owner: "acme", repo: "handbook" })).toBe("not_found");
    expect(await kindOf(host.resolveRef(HANDBOOK, { kind: "name", name: "main" }))).toBe(
      "not_found",
    );
    expect(await kindOf(host.resolveRef(HANDBOOK, { kind: "commit", hash: "a".repeat(40) }))).toBe(
      "not_found",
    );
  });
});

describe("one git host over several", () => {
  const stub = (answer: string): GitHost => ({
    async getRepository() {
      return {
        hostRepoId: answer,
        owner: { hostAccountId: answer, login: answer, kind: "organization" },
        name: answer,
        defaultBranch: "main",
        description: undefined,
        visibility: "public",
      };
    },
    async resolveRef() {
      return answer;
    },
    async getTree() {
      return { entries: [], truncated: false };
    },
    async readBlob() {
      return new Uint8Array();
    },
  });

  it("asks the host of the address, and knows no host it was not given", async () => {
    const routed = routeGitHosts({ gh: stub("github"), local: stub("directory") });
    expect((await routed.getRepository({ host: "gh", owner: "a", repo: "b" })).name).toBe("github");
    expect(await routed.resolveRef({ host: "local", owner: "a", repo: "b" }, undefined)).toBe(
      "directory",
    );
    const alone = routeGitHosts({ gh: stub("github") });
    expect(await kindOf(alone.getRepository({ host: "local", owner: "a", repo: "b" }))).toBe(
      "not_found",
    );
    // A host without the bulk transport answers an empty archive.
    const archive = routed.readArchive;
    if (archive === undefined) throw new Error("no archive");
    const files = [];
    for await (const file of archive({ host: "gh", owner: "a", repo: "b" }, "c", {
      wants: () => true,
      maxArchiveBytes: 1024,
    })) {
      files.push(file);
    }
    expect(files).toEqual([]);
  });
});
