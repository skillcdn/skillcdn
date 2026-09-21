import {
  type Address,
  type Clock,
  DomainError,
  type Entitlements,
  type GitHost,
  GitHostError,
  type IndexLimits,
  isAnonymouslyReadable,
  type RepoCoordinates,
} from "@skillcdn/core";
import {
  type Database,
  deleteRepoAlias,
  findCachedRef,
  findRepoByAlias,
  type RepoRecord,
  saveCachedRef,
  saveRepository,
} from "@skillcdn/db";

/** An address resolved to a repository and a commit: what tools answer from. */
export interface Mount {
  readonly address: Address;
  readonly coordinates: RepoCoordinates;
  readonly repo: RepoRecord;
  readonly commit: string;
  /** Limits that replace the configured defaults for this account. */
  readonly limits: Partial<IndexLimits>;
}

export type MountErrorCode =
  /** Missing, private or otherwise invisible: callers cannot tell which. */
  "repo_not_found" | "ref_not_found" | "not_allowed" | "rate_limited" | "unavailable";

export class MountError extends DomainError {
  readonly reason: MountErrorCode;
  /** Safe to show to the caller. */
  readonly detail: string;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    reason: MountErrorCode,
    detail: string,
    options?: { readonly cause?: unknown; readonly retryAfterSeconds?: number },
  ) {
    super(`mount.${reason}`, detail, options);
    this.reason = reason;
    this.detail = detail;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export interface MountServiceOptions {
  readonly database: Database;
  readonly gitHost: GitHost;
  readonly clock: Clock;
  readonly entitlements: Entitlements;
  /** How long what the host said about a repository name is trusted. */
  readonly repoTtlMs: number;
  /** How long a moving ref is trusted. */
  readonly refTtlMs: number;
  /** How much older than its TTL a fact may be when the host cannot be asked. */
  readonly staleGraceMs: number;
}

const MAX_REMEMBERED_MISSING = 10_000;

function refNotFound(address: Address): MountError {
  const ref = address.ref?.kind === "name" ? address.ref.name : undefined;
  // The hint is derived from the address alone, so it says nothing about the repository.
  const [firstSegment] = address.path.split("/");
  const hint =
    ref !== undefined && !ref.includes("/") && firstSegment !== undefined && firstSegment !== ""
      ? ` If the ref name contains "/", end it with ":", for example "@${ref}/${firstSegment}:".`
      : "";
  return new MountError("ref_not_found", `The ref was not found in this repository.${hint}`);
}

function hostUnavailable(error: GitHostError): MountError {
  return error.kind === "rate_limited"
    ? new MountError("rate_limited", "The git host is rate limiting requests. Try again later.", {
        cause: error,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      })
    : new MountError("unavailable", "The git host could not be reached. Try again later.", {
        cause: error,
      });
}

/**
 * Resolves addresses through the database first and the git host second. Facts about names and
 * moving refs are trusted for a TTL, revalidated after it, and tolerated a little longer when the
 * host cannot be asked. Pinned commits are confirmed once and then never again.
 */
export class MountService {
  readonly #options: MountServiceOptions;
  /** Collapses concurrent resolutions of one thing into one upstream call. */
  readonly #inFlight = new Map<string, Promise<unknown>>();
  /**
   * Names the host recently said do not exist, and until when that is believed. Asking again
   * costs a request against the host's quota every time, and anyone can ask for any name.
   */
  readonly #missing = new Map<string, number>();

  constructor(options: MountServiceOptions) {
    this.#options = options;
  }

  async resolve(address: Address): Promise<Mount> {
    const coordinates = { host: address.host, owner: address.owner, repo: address.repo };
    const repo = await this.#singleFlight(
      `repo ${address.host}/${address.owner}/${address.repo}`,
      () => this.#resolveRepository(coordinates),
    );

    // Anonymous access is for public repositories. Everything else looks like it does not exist.
    if (!isAnonymouslyReadable(repo.repository)) {
      throw new MountError("repo_not_found", "The repository was not found.");
    }
    const decision = await this.#options.entitlements.check({
      action: "mount",
      account: repo.repository.owner,
      repository: {
        hostRepoId: repo.repository.hostRepoId,
        visibility: repo.repository.visibility,
      },
    });
    if (!decision.allowed) {
      throw new MountError("not_allowed", decision.reason);
    }

    const refKey =
      address.ref === undefined
        ? ""
        : address.ref.kind === "commit"
          ? address.ref.hash
          : address.ref.name;
    let commit: string;
    try {
      commit = await this.#singleFlight(`ref ${repo.id} ${refKey}`, () =>
        this.#resolveCommit(address, coordinates, repo, refKey),
      );
    } catch (error) {
      // Callers that shared one lookup still get the hint that fits their own address.
      throw error instanceof MountError && error.reason === "ref_not_found"
        ? refNotFound(address)
        : error;
    }
    return { address, coordinates, repo, commit, limits: decision.limits ?? {} };
  }

  async #resolveRepository(coordinates: RepoCoordinates): Promise<RepoRecord> {
    const { database, gitHost, clock, repoTtlMs, staleGraceMs } = this.#options;
    const name = `${coordinates.host}/${coordinates.owner}/${coordinates.repo}`;
    if ((this.#missing.get(name) ?? 0) > clock.now().getTime()) {
      throw new MountError("repo_not_found", "The repository was not found.");
    }
    const cached = await findRepoByAlias(database, coordinates);
    const age =
      cached === undefined ? undefined : clock.now().getTime() - cached.checkedAt.getTime();
    if (cached !== undefined && age !== undefined && age < repoTtlMs) {
      return cached;
    }
    try {
      const repository = await gitHost.getRepository(coordinates);
      return await saveRepository(database, coordinates, repository, clock.now());
    } catch (error) {
      if (!(error instanceof GitHostError)) {
        throw error;
      }
      if (error.kind === "not_found") {
        if (cached !== undefined) {
          await deleteRepoAlias(database, coordinates);
        }
        this.#rememberMissing(name, clock.now().getTime() + repoTtlMs);
        throw new MountError("repo_not_found", "The repository was not found.", { cause: error });
      }
      if (cached !== undefined && age !== undefined && age < repoTtlMs + staleGraceMs) {
        return cached;
      }
      throw hostUnavailable(error);
    }
  }

  async #resolveCommit(
    address: Address,
    coordinates: RepoCoordinates,
    repo: RepoRecord,
    refKey: string,
  ): Promise<string> {
    const { database, gitHost, clock, refTtlMs, staleGraceMs } = this.#options;
    const scope = { accountId: repo.accountId, repoId: repo.id };
    const cached = await findCachedRef(database, scope, refKey);
    const pinned = address.ref?.kind === "commit";
    const age =
      cached === undefined ? undefined : clock.now().getTime() - cached.checkedAt.getTime();
    // A pinned commit that the host confirmed once is confirmed for good.
    if (cached !== undefined && (pinned || (age !== undefined && age < refTtlMs))) {
      return cached.commitSha;
    }
    try {
      const commit = await gitHost.resolveRef(coordinates, address.ref);
      await saveCachedRef(database, scope, refKey, commit, clock.now());
      return commit;
    } catch (error) {
      if (!(error instanceof GitHostError)) {
        throw error;
      }
      if (error.kind === "not_found" || error.kind === "invalid") {
        throw refNotFound(address);
      }
      if (cached !== undefined && age !== undefined && age < refTtlMs + staleGraceMs) {
        return cached.commitSha;
      }
      throw hostUnavailable(error);
    }
  }

  #rememberMissing(name: string, until: number): void {
    this.#missing.delete(name);
    this.#missing.set(name, until);
    if (this.#missing.size > MAX_REMEMBERED_MISSING) {
      const oldest = this.#missing.keys().next().value;
      if (oldest !== undefined) {
        this.#missing.delete(oldest);
      }
    }
  }

  async #singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.#inFlight.get(key);
    if (running !== undefined) {
      return running as Promise<T>;
    }
    const started = work().finally(() => {
      this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, started);
    return started;
  }
}
