import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  type AddressHost,
  type AddressRef,
  type ArchiveFile,
  type ArchiveRequest,
  type GitHost,
  GitHostError,
  type HostRepository,
  type IndexLimits,
  LOCAL_HOST_KEY,
  type RepoCoordinates,
  type RepoPath,
  type RepoTree,
} from "@skillcdn/core";
import {
  bytesOf,
  type LocalFile,
  openWorkingTreeFile,
  readWorkingTree,
  type WorkingTreeFile,
} from "@skillcdn/indexer";

// The git-host port over a directory of the deployment's own filesystem (ADR-0071): the packs
// an installation keeps where no git host can be read from, each a directory `<owner>/<name>`
// under the configured root, served at `/local/<owner>/<name>` as a repository is. A working
// tree has no commits, so the hash of its tree stands in for one: the same files are the same
// commit, and a changed file is a new one, indexed when it is next asked for while the one
// before answers (ADR-0068). Nothing in a directory is executed, and nothing outside the root is
// ever read: the names of an address are the grammar's, and the root is resolved once. The
// files the reading rules do not read as text are read from disk when something asks for their
// bytes, and sent as they are by the route of ADR-0077.

export interface DirectoryHostOptions {
  /** The directory whose children are the owners, and their children the packs. */
  readonly root: string;
  /** What is read of a file: the indexer's limits, as a commit is read under them. */
  readonly limits: IndexLimits;
}

interface Read {
  readonly commit: string;
  readonly files: readonly LocalFile[];
  readonly byHash: ReadonlyMap<string, LocalFile>;
}

/** What a name of a `local` address may be (specs/address.md): the parser's rule, kept here too. */
const NAME = /^[a-z0-9_][a-z0-9._-]{0,99}$/i;

/** The commit a working tree stands in for: the hash of its paths and the hashes of their bytes. */
function commitOf(files: readonly LocalFile[]): string {
  const tree = createHash("sha1");
  for (const file of files) {
    tree.update(`${file.entry.type} ${file.entry.hash} ${file.entry.size} ${file.entry.path}\n`);
  }
  return tree.digest("hex");
}

const notFound = (what: string) => new GitHostError("not_found", what);

/**
 * The directory of a pack under `root`, or nothing, in the words of any name that is nothing:
 * the names are the grammar's, and the directory is under the root or it is not a pack.
 */
async function packDirectoryOf(root: string, coordinates: RepoCoordinates): Promise<string> {
  const { host, owner, repo } = coordinates;
  if (host !== LOCAL_HOST_KEY || !NAME.test(owner) || !NAME.test(repo)) {
    throw notFound("no such pack");
  }
  const directory = join(root, owner, repo);
  if (!directory.startsWith(`${root}${sep}`)) {
    throw notFound("no such pack");
  }
  let isDirectory = false;
  try {
    isDirectory = (await stat(directory)).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw notFound("no such pack");
  }
  return directory;
}

/**
 * A file of a pack of the directory, opened for its bytes to be sent as they are (ADR-0077):
 * under the pack's directory and through no symbolic link, else nothing. Whether the file is
 * one the pack serves is the caller's to know, from the index.
 */
export async function openPackFile(
  root: string,
  coordinates: RepoCoordinates,
  path: RepoPath,
): Promise<WorkingTreeFile | undefined> {
  try {
    return await openWorkingTreeFile(await packDirectoryOf(resolve(root), coordinates), path);
  } catch {
    return undefined;
  }
}

export function createDirectoryHost(options: DirectoryHostOptions): GitHost {
  const root = resolve(options.root);
  /** The last read of each pack, by `owner/name`: what `getTree` and `readBlob` answer from. */
  const reads = new Map<string, Read>();
  const keyOf = (coordinates: RepoCoordinates): string =>
    `${coordinates.owner}/${coordinates.repo}`;

  const read = async (coordinates: RepoCoordinates): Promise<Read> => {
    const directory = await packDirectoryOf(root, coordinates);
    let files: LocalFile[];
    try {
      files = (await readWorkingTree(directory, options.limits)).files;
    } catch (error) {
      throw new GitHostError("transient", "the directory could not be read", { cause: error });
    }
    const made: Read = {
      commit: commitOf(files),
      files,
      byHash: new Map(files.map((file) => [file.entry.hash, file])),
    };
    reads.set(keyOf(coordinates), made);
    return made;
  };

  /** The read a commit names: the last one when it is of that commit, else the directory read again. */
  const readAt = async (coordinates: RepoCoordinates, commit: string): Promise<Read> => {
    const current = reads.get(keyOf(coordinates));
    const read_ = current?.commit === commit ? current : await read(coordinates);
    if (read_.commit !== commit) {
      // The files changed between the request that resolved them and this one: the index of
      // that moment cannot be built any more, and the next request resolves what is there now.
      throw new GitHostError("transient", "the directory changed while it was read");
    }
    return read_;
  };

  /** The bytes of a file of a read: read with the tree, or from disk now; a file that changed meanwhile is a changed directory. */
  const bytesOfFile = async (file: LocalFile): Promise<Uint8Array | undefined> => {
    try {
      return await bytesOf(file);
    } catch (error) {
      throw new GitHostError("transient", "the directory changed while it was read", {
        cause: error,
      });
    }
  };

  return {
    async getRepository(coordinates): Promise<HostRepository> {
      await packDirectoryOf(root, coordinates);
      return {
        hostRepoId: keyOf(coordinates),
        owner: { hostAccountId: coordinates.owner, login: coordinates.owner, kind: "organization" },
        name: coordinates.repo,
        defaultBranch: "working",
        description: undefined,
        visibility: "public",
      };
    },
    async resolveRef(coordinates, ref: AddressRef | undefined): Promise<string> {
      // A working tree is what it is: no branch, tag or commit of it is addressed (ADR-0053).
      if (ref !== undefined) {
        throw notFound("a pack served from a directory has no refs");
      }
      return (await read(coordinates)).commit;
    },
    async getTree(coordinates, commit): Promise<RepoTree> {
      const { files } = await readAt(coordinates, commit);
      return { entries: files.map((file) => file.entry), truncated: false };
    },
    async readBlob(coordinates, hash, maxBytes): Promise<Uint8Array> {
      const current = reads.get(keyOf(coordinates)) ?? (await read(coordinates));
      const file = current.byHash.get(hash);
      if (file === undefined || (file.bytes === undefined && file.read === undefined)) {
        throw notFound("no such file in the pack");
      }
      if (file.entry.size > maxBytes) {
        throw new GitHostError("invalid", "the file is larger than the limit");
      }
      const bytes = await bytesOfFile(file);
      if (bytes === undefined) {
        throw notFound("no such file in the pack");
      }
      return bytes;
    },
    // The files were read with the tree, or are read from disk now: the archive is the same
    // bytes, in one pass.
    async *readArchive(coordinates, commit, request: ArchiveRequest): AsyncIterable<ArchiveFile> {
      const { files } = await readAt(coordinates, commit);
      let total = 0;
      for (const file of files) {
        if (
          (file.bytes === undefined && file.read === undefined) ||
          !request.wants(file.entry.path, file.entry.size)
        ) {
          continue;
        }
        const bytes = await bytesOfFile(file);
        if (bytes === undefined) {
          continue;
        }
        total += bytes.byteLength;
        if (total > request.maxArchiveBytes) {
          return;
        }
        yield { path: file.entry.path, bytes };
      }
    },
  };
}

/**
 * One git host over several, each answering for the addresses of its host key: the git host
 * for `gh`, the directory host for `local` (ADR-0071). A host that is not there is a name that
 * is nothing, in the same words as any other.
 */
export function routeGitHosts(hosts: Partial<Record<AddressHost, GitHost>>): GitHost {
  const hostOf = (coordinates: RepoCoordinates): GitHost => {
    const host = hosts[coordinates.host];
    if (host === undefined) {
      throw notFound("no such host");
    }
    return host;
  };
  // Every method rejects, as the port says, a host that is not there included.
  return {
    async getRepository(coordinates) {
      return hostOf(coordinates).getRepository(coordinates);
    },
    async resolveRef(coordinates, ref) {
      return hostOf(coordinates).resolveRef(coordinates, ref);
    },
    async getTree(coordinates, commit) {
      return hostOf(coordinates).getTree(coordinates, commit);
    },
    async readBlob(coordinates, hash, maxBytes) {
      return hostOf(coordinates).readBlob(coordinates, hash, maxBytes);
    },
    // A host without the bulk transport answers an empty archive: every file is then read one by one.
    async *readArchive(coordinates, commit, request) {
      const host = hostOf(coordinates);
      if (host.readArchive !== undefined) {
        yield* host.readArchive(coordinates, commit, request);
      }
    },
  };
}
