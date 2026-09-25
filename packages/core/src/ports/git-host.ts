import type { AddressRef, GitHostKey } from "../address.js";
import { DomainError } from "../errors.js";
import type { RepoPath } from "../repo-path.js";

/** Where a repository lives, as written in an address. */
export interface RepoCoordinates {
  readonly host: GitHostKey;
  readonly owner: string;
  readonly repo: string;
}

export interface HostAccount {
  /** The host's immutable id for the account. */
  readonly hostAccountId: string;
  readonly login: string;
  readonly kind: "organization" | "user";
}

export interface HostRepository {
  /** The host's immutable id for the repository. It survives renames and transfers. */
  readonly hostRepoId: string;
  readonly owner: HostAccount;
  /** The name as the host spells it. */
  readonly name: string;
  readonly defaultBranch: string;
  /** What the host shows as the repository's description, on one line; `undefined` when there is none. */
  readonly description: string | undefined;
  /** Anything the host does not report as public is `private`. */
  readonly visibility: "public" | "private";
}

export interface TreeEntry {
  readonly path: RepoPath;
  /** Symlinks and submodules are listed so they can be reported, and are never followed. */
  readonly type: "file" | "symlink" | "submodule";
  /** Size in bytes; zero for anything that is not a file. */
  readonly size: number;
  /** The git object hash of the entry. For a file it identifies the content. */
  readonly hash: string;
}

export interface RepoTree {
  readonly entries: readonly TreeEntry[];
  /**
   * True when entries that may govern others are missing: the host cut the listing short, or a
   * repository manifest could not be represented. Other entries an adapter cannot name safely are
   * simply left out. Nothing is published from a truncated tree.
   */
  readonly truncated: boolean;
}

export interface ArchiveFile {
  readonly path: RepoPath;
  readonly bytes: Uint8Array;
}

export interface ArchiveRequest {
  /** Asked for every regular file in the archive. Only accepted files are read into memory. */
  readonly wants: (path: RepoPath, size: number) => boolean;
  /**
   * Stop after this many bytes of unpacked archive. The count is taken after decompression, so a
   * small download that unpacks into something huge stops here too.
   */
  readonly maxArchiveBytes: number;
}

export type GitHostErrorKind =
  /** Missing, or not visible with the credentials in use. Callers must not tell the two apart. */
  | "not_found"
  | "rate_limited"
  /** Worth retrying: network failures and server errors. */
  | "transient"
  /** The host understood the request and will never serve it, for example an oversized blob. */
  | "invalid";

export class GitHostError extends DomainError {
  readonly kind: GitHostErrorKind;
  /** For `rate_limited`: when the host said to come back. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: GitHostErrorKind,
    message: string,
    options?: { readonly cause?: unknown; readonly retryAfterSeconds?: number },
  ) {
    super(`git_host.${kind}`, message, options);
    this.kind = kind;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/**
 * What the domain needs from a git host. Every method rejects with a {@link GitHostError}.
 * Implementations validate what the host returns; callers receive domain types only.
 */
export interface GitHost {
  getRepository(coordinates: RepoCoordinates): Promise<HostRepository>;

  /** Resolves a ref to a full commit hash. `undefined` means the default branch. */
  resolveRef(coordinates: RepoCoordinates, ref: AddressRef | undefined): Promise<string>;

  /** Lists every entry of the commit's tree, without following symlinks or submodules. */
  getTree(coordinates: RepoCoordinates, commit: string): Promise<RepoTree>;

  /** Reads a file by content hash. Rejects as `invalid` when it is larger than `maxBytes`. */
  readBlob(coordinates: RepoCoordinates, hash: string, maxBytes: number): Promise<Uint8Array>;

  /**
   * Optional bulk transport: the files of a commit in one request instead of one per file. It is
   * an optimization and nothing more. An archive may leave files out, convert line endings or
   * expand keywords, and it ends early at `maxArchiveBytes`, so callers check every file against
   * the hash in the tree and fetch what is missing with {@link GitHost.readBlob}. Leaving the
   * iteration early cancels the download.
   */
  readArchive?(
    coordinates: RepoCoordinates,
    commit: string,
    request: ArchiveRequest,
  ): AsyncIterable<ArchiveFile>;
}
