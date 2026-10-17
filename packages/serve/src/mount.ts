import type { MountContext } from "@skillcdn/reader";

/**
 * What the edges need to know of a mount beyond what the reader does: how long a client may
 * keep what it reads, and whose the answers are. A deployment fills these from the git host;
 * the command serving a directory says that nothing is to be kept and that the answers are one
 * machine's.
 */
export interface ServedMount extends MountContext {
  /**
   * Until when the ref's resolution is trusted; `undefined` for a pinned commit, which never
   * changes. What a client may cache what it reads is bounded by it.
   */
  readonly trustedUntil: Date | undefined;
  /** Whether everyone can see the repository, or only the people the host lets. */
  readonly visibility: "public" | "private";
}
