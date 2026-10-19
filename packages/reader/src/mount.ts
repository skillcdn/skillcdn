import type { Address, IndexLimits, RepoPath } from "@skillcdn/core";

/**
 * What the reader needs to know of a mount: the address and the commit it serves, whether
 * someone vouched for it, the limits that hold for it, and where its files are at their source.
 * A deployment resolves one from a git host; the command makes one of a directory. Whatever
 * else the caller knows of its mount travels along, and the reader passes it back untouched
 * when it asks the caller for the index or for a body.
 */
export interface MountContext {
  readonly address: Address;
  readonly commit: string;
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
}
