import type { Address, IndexLimits, NewestCommit, RepoPath } from "@skillcdn/core";

/**
 * What the reader needs to know of a mount: the address and the commit it serves, whether
 * someone vouched for it, the limits that hold for it, and where its files are at their source.
 * A deployment resolves one from a git host; the command makes one of a directory. Whatever
 * else the caller knows of its mount travels along, and the reader passes it back untouched
 * when it asks the caller for the index or for a body.
 */
export interface MountContext {
  readonly address: Address;
  /** The commit the mount serves: the one the address resolves to, as the caller resolved it. */
  readonly commit: string;
  /**
   * The newest commit of the ref while the index served is another one's (ADR-0068). A caller
   * leaves it out: the reader sets it on the mount it answers from when the index it is handed
   * is a substitute, with `commit` changed to the one that index was built from.
   */
  readonly newest?: NewestCommit | undefined;
  /**
   * Whether someone has vouched for the repository: its owner, the operator, or the person who
   * chose the directory. Results say so when nobody has, and the license decides what is served.
   */
  readonly verified: boolean;
  /**
   * Whether everyone can see the repository or only the people the host lets; `public` when not
   * said. Results carry it, and a private repository carries no provenance notice (ADR-0061).
   */
  readonly visibility?: "public" | "private";
  /** Limits that replace the configured defaults for this mount. */
  readonly limits: Partial<IndexLimits>;
  /** `owner/name` as the host spells it, or as the directory is called: what results name as the repository. */
  readonly repository: string;
  /** What the host, or the directory, says the repository is about, when anything. */
  readonly description: string | undefined;
  /** Where a file can be read at its source, for a reader sent there: a page for a person. */
  sourceUrl(path: RepoPath): string;
  /** Where the bytes of a file are at its source, for a reader that has to fetch them itself. */
  rawUrl(path: RepoPath): string;
  /**
   * Where the host serves a file kept in Git LFS, whose bytes at `rawUrl` are the pointer
   * (ADR-0077); left out, `rawUrl` stands for it, as it does where there is no LFS.
   */
  lfsUrl?(path: RepoPath): string;
}
