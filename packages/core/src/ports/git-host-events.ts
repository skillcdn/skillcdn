import type { GitHostKey } from "../address.js";
import { DomainError } from "../errors.js";

/**
 * What an event is about: repositories named by the host's immutable ids, or everything of one
 * account.
 */
export type HostEventScope =
  | { readonly hostRepoIds: readonly string[] }
  | { readonly hostAccountId: string };

/**
 * Something the git host says happened, reduced to what it ends of what a deployment remembers
 * (docs/specs/permissions.md). An event never says what is true now: it says what to stop
 * believing, and the host is asked again. So an event that arrives twice, late or out of order
 * costs a question and changes no answer.
 */
export type GitHostEvent =
  /** Branches or tags of a repository moved, appeared or went. */
  | { readonly kind: "refs_changed"; readonly hostRepoId: string }
  /**
   * What the host says about a repository changed: its name, its owner, its default branch, its
   * description or who it is shown to. `closed` says that it stopped being public (`private`)
   * or stopped being (`gone`), which is believed at once: closing is the one thing an event is
   * taken at its word for.
   */
  | {
      readonly kind: "repository_changed";
      readonly hostRepoId: string;
      readonly closed: "private" | "gone" | undefined;
    }
  /** Who the host lets see repositories changed: collaborators, teams, members. */
  | { readonly kind: "access_changed"; readonly scope: HostEventScope }
  /**
   * The app was taken off repositories, or off an account altogether: it may read them no
   * longer, and what it read of them while they were not public is not kept.
   */
  | { readonly kind: "installation_removed"; readonly scope: HostEventScope }
  /** A person took back what they allowed the app: the host no longer accepts their credential. */
  | { readonly kind: "authorization_revoked"; readonly hostAccountId: string };

/** One delivery of the git host, read: what it is called, and what it ends. */
export interface GitHostDelivery {
  /** The host's own id of the delivery, for the log; `undefined` when it sent none. */
  readonly id: string | undefined;
  /** What the host calls what happened, for the log: `push`, `repository.privatized`. */
  readonly name: string;
  /** Empty for a delivery that ends nothing here. */
  readonly events: readonly GitHostEvent[];
}

export type GitHostDeliveryProblem =
  /** Not signed by the host with the secret it shares with the deployment. */
  | "unsigned"
  /** Signed, and not readable as what the host says it is. */
  | "malformed";

export class GitHostDeliveryError extends DomainError {
  readonly problem: GitHostDeliveryProblem;

  constructor(problem: GitHostDeliveryProblem, message: string, options?: { cause?: unknown }) {
    super(`webhook.${problem}`, message, options);
    this.problem = problem;
  }
}

/**
 * Reads what a git host delivers to a deployment. A delivery is untrusted until its signature
 * is verified, over the bytes as they arrived and before any of them is parsed; `read` throws a
 * {@link GitHostDeliveryError} for one that is not the host's, and for one it cannot read.
 */
export interface GitHostEventSource {
  /** The git host the deliveries come from, and are about. */
  readonly host: GitHostKey;

  read(delivery: {
    /** The value of a request header, by its lowercase name. */
    readonly header: (name: string) => string | undefined;
    /** The request body, byte for byte. */
    readonly body: Uint8Array;
  }): GitHostDelivery;
}
