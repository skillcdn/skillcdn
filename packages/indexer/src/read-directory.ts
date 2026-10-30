import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import {
  type BlobStore,
  baseName,
  classifyRepoFile,
  decodeText,
  type GitHost,
  GitHostError,
  type IndexLimits,
  isLicenseFileName,
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
  /**
   * The bytes of a file of the tree by its hash, as the git host in memory answers them: from
   * the store, or from disk for a file the tree lists without reading (ADR-0077). Rejects as a
   * git host does: `not_found` for a hash the tree does not have, `invalid` over `maxBytes`.
   */
  readBlob(hash: string, maxBytes: number): Promise<Uint8Array>;
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
  /**
   * The bytes, for a file the reading rules read as text: read with the tree. Left out for a
   * file they never read as text, a picture or an original, whose bytes `read` reads from disk
   * when something asks for them, and for a file too large to be indexed or read, which has no
   * `read` either: listed, never read.
   */
  readonly bytes: Uint8Array | undefined;
  readonly read?: () => Promise<Uint8Array>;
}

/** The commit a working tree stands in for, in results. */
export const WORKING_TREE_COMMIT = "0".repeat(40);

/** Entries a working tree has and a git tree does not, or that are never served anyway. */
function isSkipped(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

/**
 * Whether the reading rules read a file as text wherever it is: a declaration, a document, a
 * license. Every other file is listed with its size and read only when something asks for its
 * bytes, so that a pack's pictures and originals cost a reread nothing (ADR-0077).
 */
function readWithTree(path: RepoPath): boolean {
  return classifyRepoFile(path) !== "other" || isLicenseFileName(baseName(path));
}

/** Reads a file the tree listed without reading, as it is now; rejects when it is not that file any more. */
async function readLater(absolute: string, size: number): Promise<Uint8Array> {
  const info = await lstat(absolute);
  if (!info.isFile() || info.size !== size) {
    throw new Error("the file changed since the directory was read");
  }
  return new Uint8Array(await readFile(absolute));
}

/**
 * The files of a directory as tree entries: `.git`, `node_modules` and ordinary symbolic links
 * are left out. A symlink policy remains an unreadable boundary, without following its target.
 * Hidden skills and explicitly referenced files follow the indexer's rules. A file the reading
 * rules read as text is read and hashed as git hashes it; any other file gets a stand-in hash
 * from its path, size and modification time, so that a changed file is a new tree, and is read
 * from disk when its bytes are asked for; a file too large to be indexed or read gets a stand-in
 * hash from its path alone: nothing ever asks for its body. The entries come in byte order of
 * path, so that two reads of the same files are the same list.
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
      const info = await stat(absolute);
      const { size } = info;
      // The indexer asks for bodies up to the larger of the two limits: searched content up to
      // one, the files a skill is served with up to the other.
      if (size > Math.max(limits.maxIndexedFileBytes, limits.maxReadableFileBytes)) {
        const hash = createHash("sha1").update(`unread ${path}`).digest("hex");
        files.push({ entry: { path: parsed.value, type: "file", size, hash }, bytes: undefined });
        continue;
      }
      if (!readWithTree(parsed.value)) {
        // The stand-in names the file where it is, so that the same bytes in two packs on one
        // disk are not taken for one another in a store they share.
        const hash = createHash("sha1")
          .update(`unread ${root}\0${path}\0${size}\0${Math.floor(info.mtimeMs)}`)
          .digest("hex");
        files.push({
          entry: { path: parsed.value, type: "file", size, hash },
          bytes: undefined,
          read: () => readLater(absolute, size),
        });
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

/** The bytes of a file of the tree, read with it or from disk now; `undefined` for one that is only listed. */
export async function bytesOf(file: LocalFile): Promise<Uint8Array | undefined> {
  return file.bytes ?? (await file.read?.());
}

/** A file of a working tree opened for its bytes to be sent as they are (ADR-0077). */
export interface WorkingTreeFile {
  readonly size: number;
  /** The bytes, streamed from disk. */
  readonly body: () => ReadableStream<Uint8Array>;
}

/**
 * Opens a file of a working tree for its bytes to be sent as they are: the file at `path` under
 * `root`, when it is a regular file reached through no symbolic link, and nothing else, so that
 * nothing outside the root is ever read; `undefined` otherwise.
 */
export async function openWorkingTreeFile(
  root: string,
  path: RepoPath,
): Promise<WorkingTreeFile | undefined> {
  if (path.length === 0) {
    return undefined;
  }
  const base = resolve(root);
  const absolute = join(base, ...path.split("/"));
  if (!absolute.startsWith(`${base}${sep}`)) {
    return undefined;
  }
  try {
    // The real path differs from the one asked for where a link is on the way: that is refused.
    const [realRoot, realFile, info] = await Promise.all([
      realpath(base),
      realpath(absolute),
      lstat(absolute),
    ]);
    if (!info.isFile() || realFile !== join(realRoot, ...path.split("/"))) {
      return undefined;
    }
    return {
      size: info.size,
      body: () => Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>,
    };
  } catch {
    return undefined;
  }
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
  const readBlob = async (hash: string, maxBytes: number): Promise<Uint8Array> => {
    const file = byHash.get(hash);
    if (file === undefined || (file.bytes === undefined && file.read === undefined)) {
      throw new GitHostError("not_found", "no such file in the directory");
    }
    if (file.entry.size > maxBytes) {
      throw new GitHostError("invalid", "the file is larger than the limit");
    }
    let bytes: Uint8Array | undefined;
    try {
      bytes = await bytesOf(file);
    } catch (error) {
      throw new GitHostError("transient", "the file changed while the directory was read", {
        cause: error,
      });
    }
    if (bytes === undefined) {
      throw new GitHostError("not_found", "no such file in the directory");
    }
    return bytes;
  };
  const gitHost: Pick<GitHost, "getTree" | "readBlob"> = {
    async getTree() {
      return { entries: files.map((file) => file.entry), truncated: false };
    },
    readBlob: (_coordinates, hash, maxBytes) => readBlob(hash, maxBytes),
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
  return {
    root,
    index,
    blobs,
    readBlob,
    fileCount: files.length,
    skipped,
    commit: WORKING_TREE_COMMIT,
  };
}
