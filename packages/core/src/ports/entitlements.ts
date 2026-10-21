import type { HostAccount } from "./git-host.js";

/**
 * Limits on the work one repository may cause. Defaults come from configuration; an
 * {@link Entitlements} implementation may replace any of them for an account.
 */
export interface IndexLimits {
  /** Tree entries listed per commit. */
  readonly maxTreeEntries: number;
  /** Files whose text is fetched and made searchable per commit. */
  readonly maxIndexedFiles: number;
  /** Size of one searchable file, in bytes. */
  readonly maxIndexedFileBytes: number;
  /** Sum of the searchable files of one commit, in bytes. */
  readonly maxIndexedTotalBytes: number;
  /** Size of a file served by `read_file`, in bytes. */
  readonly maxReadableFileBytes: number;
  /** Unpacked size of a commit archive that the indexer is willing to read through, in bytes. */
  readonly maxArchiveBytes: number;
}

/**
 * Bounds on what is embedded for the search by meaning (ADR-0064): the bytes of the bodies sent
 * to the embedding model. There are no defaults; a bound an implementation leaves out is none.
 */
export interface EmbedLimits {
  /** Bytes of bodies embedded for one repository, over every commit of it, under the model in use. */
  readonly maxBytesPerRepository: number;
  /** Bytes of bodies embedded for one account on one day (UTC). */
  readonly maxBytesPerAccountPerDay: number;
}

export type EntitlementAction =
  /** Serve requests for a repository. */
  | "mount"
  /** Build the index for a commit. */
  | "index"
  /** Embed the sections of a commit's documents for the search by meaning (ADR-0064). */
  | "embed";

export interface EntitlementQuery {
  readonly action: EntitlementAction;
  /** The account that owns the repository. */
  readonly account: HostAccount;
  readonly repository: {
    readonly hostRepoId: string;
    readonly visibility: "public" | "private";
    /** The repository as an address names it: the host key, the owner and the name. */
    readonly host: string;
    readonly owner: string;
    readonly name: string;
  };
}

export type EntitlementDecision =
  | {
      readonly allowed: true;
      readonly limits?: Partial<IndexLimits>;
      /** For `embed`: the bounds of the embedding; a bound left out is none. */
      readonly embed?: Partial<EmbedLimits>;
    }
  /**
   * `reason` is shown to the caller: keep it free of anything account-specific. A `hidden`
   * refusal is answered as if the repository did not exist, which is what a deny list needs.
   */
  | { readonly allowed: false; readonly reason: string; readonly hidden?: boolean };

/**
 * Answers "may this account do X, and within what limits". Enforcement points ask this port and
 * never branch on anything else. The implementation in this repository allows everything.
 */
export interface Entitlements {
  check(query: EntitlementQuery): Promise<EntitlementDecision>;
}

export const allowEverything: Entitlements = {
  check: async () => ({ allowed: true }),
};
