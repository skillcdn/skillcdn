import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type BlobStore,
  decodeText,
  type GitHost,
  GitHostError,
  type IndexLimits,
  parseRepoPath,
  type RepoPath,
  type SnapshotIndex,
  type TreeEntry,
} from "@skillcdn/core";
import { buildSnapshotIndex } from "./build-index.js";
import { gitBlobHash } from "./git-hash.js";

// A directory read as the indexer reads a commit (ADR-0020, ADR-0053): the files of a working
// tree as the tree entries of a git host that lives in memory, their bytes as the bodies of a
// blob store that lives there too, and the same reading rules over both. For `check`, which
// reports it, and for the command, which serves it. Nothing in the directory is executed.

export interface ReadDirectoryOptions {
  readonly directory: string;
  readonly limits: IndexLimits;
  /** What the index records as the repository, for what names it; left out, the directory's name. */
  readonly repository?: { readonly owner: string; readonly name: string } | undefined;
}

export interface ReadDirectory {
  /** The directory, resolved. */
  readonly root: string;
  readonly index: SnapshotIndex;
  /** The bodies the index names by hash, text and bytes alike. */
  readonly blobs: BlobStore;
  /** How many files the tree has, large ones included. */
  readonly fileCount: number;
  /** How many entries were left out: `.git`, `node_modules` and symbolic links. */
  readonly skipped: number;
  /** The commit a working tree stands in for. */
  readonly commit: string;
}

/** A file of a working tree: its tree entry, and its bytes where they were read. */
export interface LocalFile {
  readonly entry: TreeEntry;
  /** Left out for a file too large to be indexed: listed, never read. */
  readonly bytes: Uint8Array | undefined;
}

/** The commit a working tree stands in for, in results. */
export const WORKING_TREE_COMMIT = "0".repeat(40);

/** Entries a working tree has and a git tree does not, or that are never served anyway. */
function isSkipped(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

/**
 * The files of a directory as tree entries: `.git`, `node_modules` and ordinary symbolic links
 * are left out. A symlink policy remains an unreadable boundary, without following its target.
 * Hidden skills and explicitly referenced files follow the indexer's rules. A file too large to
 * be indexed or read gets a stand-in hash: nothing ever asks for its body. The entries come in
 * byte order of path, so that two reads of the same files are the same list.
 */
export async function readWorkingTree(
  root: string,
  limits: IndexLimits,
): Promise<{ readonly files: LocalFile[]; readonly skipped: number }> {
  const files: LocalFile[] = [];
  let skipped = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (isSkipped(entry.name)) {
        skipped += 1;
        continue;
      }
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        const parsed = entry.name === "SKILLCDN.md" ? parseRepoPath(path) : undefined;
        if (parsed?.ok === true) {
          files.push({
            entry: {
              path: parsed.value,
              type: "symlink",
              size: 0,
              hash: createHash("sha1").update(`unread policy link ${path}`).digest("hex"),
            },
            bytes: undefined,
          });
        } else {
          skipped += 1;
        }
        continue;
      }
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const parsed = parseRepoPath(path);
      if (!parsed.ok) {
        skipped += 1;
        continue;
      }
      const size = (await stat(absolute)).size;
      // The indexer asks for bodies up to the larger of the two limits: searched content up to
      // one, the files a skill is served with up to the other.
      if (size > Math.max(limits.maxIndexedFileBytes, limits.maxReadableFileBytes)) {
        const hash = createHash("sha1").update(`unread ${path}`).digest("hex");
        files.push({ entry: { path: parsed.value, type: "file", size, hash }, bytes: undefined });
        continue;
      }
      const bytes = new Uint8Array(await readFile(absolute));
      files.push({
        entry: {
          path: parsed.value,
          type: "file",
          size: bytes.byteLength,
          hash: gitBlobHash(bytes),
        },
        bytes,
      });
    }
  };
  await walk(root, "");
  return { files, skipped };
}

/**
 * Reads `directory` as the indexer reads a commit. Rejects when the directory cannot be read;
 * everything the reading rules could not read as intended is in the index's diagnostics.
 */
export async function readDirectory(options: ReadDirectoryOptions): Promise<ReadDirectory> {
  const { limits } = options;
  const root = resolve(options.directory);
  const { files, skipped } = await readWorkingTree(root, limits);
  const byHash = new Map(files.map((file) => [file.entry.hash, file]));
  const gitHost: Pick<GitHost, "getTree" | "readBlob"> = {
    async getTree() {
      return { entries: files.map((file) => file.entry), truncated: false };
    },
    async readBlob(_coordinates, hash, maxBytes) {
      const file = byHash.get(hash);
      if (file?.bytes === undefined) {
        throw new GitHostError("not_found", "no such file in the directory");
      }
      if (file.bytes.byteLength > maxBytes) {
        throw new GitHostError("invalid", "the file is larger than the limit");
      }
      return file.bytes;
    },
  };
  const bodies = new Map<string, Uint8Array>();
  const blobs: BlobStore = {
    async read(hash) {
      const body = bodies.get(hash);
      return body === undefined ? undefined : decodeText(body);
    },
    async readBytes(hash) {
      return bodies.get(hash);
    },
    async write(hash, body) {
      bodies.set(hash, body);
    },
    async missing(hashes) {
      return new Set(hashes.filter((hash) => !bodies.has(hash)));
    },
  };
  const name = options.repository ?? { owner: "local", name: basename(root) };
  const index = await buildSnapshotIndex({
    gitHost,
    blobStore: blobs,
    coordinates: { host: "gh", owner: name.owner, repo: name.name },
    // A file on this machine is at its path on this machine.
    rawUrl: (path: RepoPath) => pathToFileURL(join(root, ...path.split("/"))).href,
    commit: WORKING_TREE_COMMIT,
    limits,
    signal: new AbortController().signal,
  });
  return { root, index, blobs, fileCount: files.length, skipped, commit: WORKING_TREE_COMMIT };
}
