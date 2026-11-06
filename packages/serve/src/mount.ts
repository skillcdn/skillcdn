import { isPinnedAddress, type MountSummary } from "@skillcdn/core";
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

/**
 * What of a mount decides how a reader fetches a file at its source (`describeSource`): the
 * host, since a pack served from a directory has none to ask, and whether the repository is
 * private, since a git host serves such a file only to a credential.
 */
export function sourceAccess(
  mount: ServedMount,
): Pick<MountSummary, "host" | "visibility" | "repository"> {
  return { host: mount.address.host, repository: mount.repository, visibility: mount.visibility };
}

/**
 * How long a client may keep what a pinned address serves, in milliseconds: the commit never
 * changes, and what the deployment serves of it seldom, so a day (docs/specs/tools.md).
 */
export const PINNED_TTL_MS = 86_400_000;

/**
 * What a ready REST answer of the mount tells the caches (docs/specs/rest.md): a public address
 * pinned to a commit may be kept a day, the bound the skills extension gives it as `ttlMs`,
 * since the operator's lists, the reading rules and the repository's visibility can still change
 * what is served of the commit; anything else is nobody's to keep, a moving ref because it
 * moves and a private repository because a shared cache would answer without the permission
 * check.
 */
export function restCacheControl(mount: ServedMount): string | undefined {
  return isPinnedAddress(mount.address) && mount.visibility === "public"
    ? `public, max-age=${PINNED_TTL_MS / 1000}`
    : undefined;
}
