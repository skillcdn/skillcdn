import type { GitHostKey } from "../address.js";
import type { HostAccount } from "./git-host.js";

/** What a git host shows of an account to anyone who asks. */
export interface HostProfile extends HostAccount {
  /** The name the account goes by, when it gives one besides its login. */
  readonly name: string | undefined;
  /** What the account says about itself, on one line. */
  readonly bio: string | undefined;
  /** How many public repositories the host counts for it. */
  readonly publicRepositories: number;
}

/** A public repository as the host lists it under its owner. Nothing here was read from the repository. */
export interface HostRepositoryListing {
  /** The host's immutable id for the repository. */
  readonly hostRepoId: string;
  /** The name as the host spells it. */
  readonly name: string;
  readonly description: string | undefined;
  readonly fork: boolean;
  readonly archived: boolean;
  readonly stars: number;
  /** When it was last pushed to, as an ISO 8601 instant; `undefined` when the host does not say. */
  readonly pushedAt: string | undefined;
}

export interface HostRepositoryPage {
  readonly repositories: readonly HostRepositoryListing[];
  /** True when the host has more than this page. */
  readonly hasMore: boolean;
}

/**
 * What the domain needs to know about the accounts of a git host: who an account is, and which
 * public repositories it has. Asked with the deployment's own credential, so the answers are
 * what everyone sees. Every method rejects with a `GitHostError`; an account that does not exist
 * is `not_found`.
 */
export interface GitHostDirectory {
  getProfile(host: GitHostKey, login: string): Promise<HostProfile>;

  /**
   * A page of the account's own public repositories, most recently pushed first. Pages start at
   * 1 and hold up to the host's page size.
   */
  listPublicRepositories(
    host: GitHostKey,
    login: string,
    page: number,
  ): Promise<HostRepositoryPage>;
}
