import {
  type Address,
  type Clock,
  DomainError,
  type EntitlementDecision,
  type Entitlements,
  formatAddress,
  type GitHost,
  GitHostError,
  type IndexLimits,
  isAnonymouslyReadable,
  type RepoCoordinates,
  ROOT_PATH,
} from "@skillcdn/core";
import {
  type Database,
  deleteRepoAlias,
  findCachedRef,
  findMissingRepo,
  findRepoByAlias,
  markRepositoryNotPublic,
  type RepoAliasRecord,
  type RepoRecord,
  saveCachedRef,
  saveMissingRepo,
  saveRepository,
  type UserRecord,
} from "@skillcdn/db";

/**
 * Who a request is for, for a request that carries a credential; a request without one is
 * nobody's, and has no viewer. Answers nobody when the credential turns out to be nobody's. It
 * is asked only once it matters, which for a repository known to be public is never.
 */
export type Viewer = () => Promise<UserRecord | undefined>;

/**
 * What the mount service needs to know about a repository that is not public: whether the git
 * host lets this person see it (docs/specs/permissions.md). Every method fails closed, and may
 * reject with a `GitHostError` when the host cannot be asked. Whatever it remembers, it
 * remembers for the person it is about: nothing here answers one person from another's question.
 */
export interface RepoPermissions {
  /** True when a moment ago this name was nothing to everyone and nothing to this person. */
  missed(user: UserRecord, coordinates: RepoCoordinates): boolean;
  /** Notes that the name is nothing to everyone and nothing to this person, for a while. */
  noteMiss(user: UserRecord, coordinates: RepoCoordinates): void;
  /**
   * The repository the git host last let this person read under this name, and whether that
   * answer is still believed. Nothing for a name that is nothing and for a repository they were
   * never let see, alike.
   */
  readable(
    user: UserRecord,
    coordinates: RepoCoordinates,
  ): Promise<{ readonly repo: RepoAliasRecord; readonly fresh: boolean } | undefined>;
  /**
   * The host's id of the repository the name means to the person, asked of the host as that
   * person, or `undefined` when it shows them none.
   */
  visibleRepository(user: UserRecord, coordinates: RepoCoordinates): Promise<string | undefined>;
  /** Notes an answer the host just gave about a repository. */
  remember(user: UserRecord, repo: RepoRecord, allowed: boolean): Promise<void>;
}

/** An address resolved to a repository and a commit: what tools answer from. */
export interface Mount {
  readonly address: Address;
  /** Where the repository is, and with which credential the git host is asked about it. */
  readonly coordinates: RepoCoordinates;
  readonly repo: RepoRecord;
  readonly commit: string;
  /** Limits that replace the configured defaults for this account. */
  readonly limits: Partial<IndexLimits>;
  /**
   * Whether someone has vouched for the repository: its owner through the git host's app, once
   * that exists, or the operator through configuration until then. Results say so when nobody has.
   */
  readonly verified: boolean;
  /**
   * The picture the operator gave the address, or its repository, when it did (ADR-0031): where
   * the pages load it from, in place of what the repository declares.
   */
  readonly image: string | undefined;
  /**
   * Until when the ref's resolution is trusted; `undefined` for a pinned commit, which never
   * changes. What a client may cache what it reads is bounded by it.
   */
  readonly trustedUntil: Date | undefined;
}

/** How a repository is named in the operator's list of verified repositories: `/gh/owner/repo`. */
export function repositoryKey(address: Address): string {
  return formatAddress({ ...address, ref: undefined, path: ROOT_PATH });
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
  /** Whether the operator vouches for a repository, by the key {@link repositoryKey} gives it. */
  readonly isVerified: (key: string) => Promise<boolean>;
  /** Where the operator's picture for an address is loaded from, when it gave one (ADR-0031). */
  readonly imageOf: (address: Address) => Promise<string | undefined>;
  /**
   * Who may see what is not public. Left out, nobody signs in on this deployment, and only
   * public repositories exist as far as it is concerned.
   */
  readonly permissions?: RepoPermissions | undefined;
}

const MAX_REMEMBERED_MISSING = 10_000;
/** What the key of a pinned commit begins with among a repository's remembered refs. */
const PINNED_KEY = "commit:";

interface ResolvedCommit {
  readonly commit: string;
  readonly trustedUntil: Date | undefined;
}

function refNotFound(address: Address): MountError {
  if (address.ref?.kind === "commit") {
    // One message for a commit that is nowhere and for one that is somebody else's.
    return new MountError(
      "ref_not_found",
      "The commit was not found in the history of this repository's default branch. A commit hash is served from there only; address anything else by the name of its branch or tag.",
    );
  }
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
 * host cannot be asked. A pinned commit is confirmed once, as a commit of the repository's own
 * history, and then never again.
 */
export class MountService {
  readonly #options: MountServiceOptions;
  /** Collapses concurrent resolutions of one thing into one upstream call. */
  readonly #inFlight = new Map<string, Promise<unknown>>();
  /**
   * Names the host recently said do not exist, and until when that is believed. Asking again
   * costs a request against the host's quota every time, and anyone can ask for any name. Only
   * requests from nobody in particular write it: see {@link MountService.resolve}. The database
   * holds the same notes for every process (`missing_repos`); this is what is at hand.
   */
  readonly #missing = new Map<string, number>();

  constructor(options: MountServiceOptions) {
    this.#options = options;
  }

  /**
   * Resolves an address for whoever `viewer` says is asking. A public repository is resolved
   * for anyone; one that is not public only for a person the git host lets see it. To everyone
   * else it does not exist, in the same words and after the same work as one that really does
   * not.
   */
  async resolve(address: Address, viewer?: Viewer): Promise<Mount> {
    const name: RepoCoordinates = { host: address.host, owner: address.owner, repo: address.repo };
    const repo = await this.#repositoryFor(name, viewer);
    // What is not public is read through the app's installation on it, never as the deployment.
    const coordinates: RepoCoordinates = isAnonymouslyReadable(repo.repository)
      ? name
      : { ...name, credential: "installation" };
    const decision = await this.#decide(address, repo);
    if (!decision.allowed) {
      throw new MountError(
        decision.hidden === true ? "repo_not_found" : "not_allowed",
        decision.reason,
      );
    }

    // A pinned commit is remembered under a key no ref name can have: git allows no colon in
    // one. What was remembered under the bare hash was confirmed to exist, which is less than
    // is asked now, and is not looked at any more.
    const refKey =
      address.ref === undefined
        ? ""
        : address.ref.kind === "commit"
          ? `${PINNED_KEY}${address.ref.hash}`
          : address.ref.name;
    let resolved: ResolvedCommit;
    try {
      resolved = await this.#singleFlight(`ref ${repo.id} ${refKey}`, () =>
        this.#resolveCommit(address, coordinates, repo, refKey),
      );
    } catch (error) {
      // Callers that shared one lookup still get the hint that fits their own address.
      throw error instanceof MountError && error.reason === "ref_not_found"
        ? refNotFound(address)
        : error;
    }
    return {
      address,
      coordinates,
      repo,
      commit: resolved.commit,
      limits: decision.limits ?? {},
      // Whoever vouched for the repository vouched for its default branch (ADR-0026).
      verified:
        address.ref === undefined && (await this.#options.isVerified(repositoryKey(address))),
      image: await this.#options.imageOf(address),
      trustedUntil: resolved.trustedUntil,
    };
  }

  /** Whether the deployment serves the repository at all, and within which limits. */
  #decide(address: Address, repo: RepoRecord): Promise<EntitlementDecision> {
    return this.#options.entitlements.check({
      action: "mount",
      account: repo.repository.owner,
      repository: {
        hostRepoId: repo.repository.hostRepoId,
        visibility: repo.repository.visibility,
        host: address.host,
        owner: repo.repository.owner.login,
        name: repo.repository.name,
      },
    });
  }

  /**
   * Whether an address is one that only some people are served: whatever is "not found" to
   * nobody in particular, be it private, hidden or nothing at all. Such an address answers a
   * request without a credential by asking for one, and says where to ask for access; an
   * address that everyone is served does neither. Nothing is read of the repository, and
   * nothing indexed. Rejects with a `MountError` when the git host could not be asked.
   */
  async asksForPermission(address: Address): Promise<boolean> {
    const name: RepoCoordinates = { host: address.host, owner: address.owner, repo: address.repo };
    try {
      const decision = await this.#decide(address, await this.#publicly(name, true));
      return !decision.allowed && decision.hidden === true;
    } catch (error) {
      if (error instanceof MountError && error.reason === "repo_not_found") {
        return true;
      }
      throw error;
    }
  }

  /**
   * Whether a name is a public repository right now, as far as the git host shows the
   * deployment. For whatever names repositories to everyone: a name that cannot be confirmed is
   * no, whether the host said so or could not be asked.
   */
  async isPublic(name: RepoCoordinates): Promise<boolean> {
    try {
      await this.#publicly({ host: name.host, owner: name.owner, repo: name.repo }, true);
      return true;
    } catch (error) {
      if (error instanceof MountError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * The repository a name means to whoever is asking.
   *
   * Nothing one caller's question leaves behind may answer another caller sooner: a stranger
   * could tell, from how fast "not found" comes, that somebody else uses the name. So a request
   * from nobody in particular meets only what such requests left: what is public, and the
   * memory of names that are nothing to the public, which only these requests write. A person's
   * request meets what is known to be public, which is everyone's to read, and beyond that only
   * what that person's own requests left: what the host last let them read, and what was nothing
   * to them. To someone who may not see it, a repository that is somebody's and a name that is
   * nothing take the same steps to the same answer.
   */
  async #repositoryFor(name: RepoCoordinates, viewer: Viewer | undefined): Promise<RepoRecord> {
    const { permissions } = this.#options;
    if (permissions === undefined || viewer === undefined) {
      return this.#publicly(name, true);
    }
    // What everyone may read needs nobody's permission: a repository known to be public is
    // answered as it is to anyone, before anyone is asked who they are.
    const open = await this.#knownPublic(name);
    if (open !== undefined) {
      return open;
    }
    const user = await viewer();
    if (user === undefined) {
      return this.#publicly(name, true);
    }
    try {
      return await this.#resolveFor(name, user, permissions);
    } catch (error) {
      // Whether this person may see it could not be asked: no answer is no access.
      throw error instanceof GitHostError ? hostUnavailable(error) : error;
    }
  }

  /** What the name is to everyone, asked once for all who ask at the same moment. */
  #publicly(name: RepoCoordinates, remember: boolean): Promise<RepoRecord> {
    return this.#singleFlight(`repo ${name.host}/${name.owner}/${name.repo}`, () =>
      this.#resolvePublic(name, remember),
    );
  }

  /** The repository a name that is not known to be public means to a person who signed in. */
  async #resolveFor(
    name: RepoCoordinates,
    user: UserRecord,
    permissions: RepoPermissions,
  ): Promise<RepoRecord> {
    const { clock, repoTtlMs } = this.#options;
    const notFound = () => new MountError("repo_not_found", "The repository was not found.");
    // Nothing to everyone and nothing to them a moment ago: nothing again, and nobody is asked.
    if (permissions.missed(user, name)) {
      throw notFound();
    }
    const known = await permissions.readable(user, name);
    if (known !== undefined) {
      const age = clock.now().getTime() - known.repo.checkedAt.getTime();
      if (known.fresh && age < repoTtlMs) {
        return known.repo;
      }
      // Theirs to read when the host was last asked: it is asked as them again before anything
      // else, so that the people of a repository coming back leave no trace on what everyone
      // is told about its name.
      const still = await this.#resolvePrivate(name, user, permissions, known.repo);
      if (still !== undefined) {
        return still;
      }
    }
    try {
      // As everyone sees it. A miss is not remembered for everyone: it was not their question.
      return await this.#publicly(name, false);
    } catch (error) {
      if (!(error instanceof MountError) || error.reason !== "repo_not_found") {
        throw error;
      }
    }
    // As the person, unless the host was just asked as them above.
    const theirs =
      known === undefined
        ? await this.#resolvePrivate(name, user, permissions, undefined)
        : undefined;
    if (theirs === undefined) {
      permissions.noteMiss(user, name);
      throw notFound();
    }
    return theirs;
  }

  /**
   * The public repository a name is known to mean right now, without asking the host: what a
   * request from nobody in particular would be answered with from the database. It is written
   * by whoever asked about a public repository and says only what the host tells everyone, so
   * reading it tells nobody anything about a repository that is not public.
   */
  async #knownPublic(coordinates: RepoCoordinates): Promise<RepoRecord | undefined> {
    const { database, clock, repoTtlMs } = this.#options;
    const known = await findRepoByAlias(database, coordinates);
    if (known === undefined || !isAnonymouslyReadable(known.repository)) {
      return undefined;
    }
    return clock.now().getTime() - known.checkedAt.getTime() < repoTtlMs ? known : undefined;
  }

  /**
   * What the name is to everyone: a public repository, or nothing. `remember` says whether a
   * name that is nothing is remembered as such for everyone, which only a question from nobody
   * in particular may cause.
   */
  async #resolvePublic(coordinates: RepoCoordinates, remember: boolean): Promise<RepoRecord> {
    const { database, gitHost, clock, repoTtlMs, staleGraceMs } = this.#options;
    const name = `${coordinates.host}/${coordinates.owner}/${coordinates.repo}`;
    if ((this.#missing.get(name) ?? 0) > clock.now().getTime()) {
      throw new MountError("repo_not_found", "The repository was not found.");
    }
    const known = await findRepoByAlias(database, coordinates);
    // What is known about a repository that is not public says nothing to the public: the host
    // is asked as it would be for a name never seen.
    const cached =
      known !== undefined && isAnonymouslyReadable(known.repository) ? known : undefined;
    const age =
      cached === undefined ? undefined : clock.now().getTime() - cached.checkedAt.getTime();
    if (cached !== undefined && age !== undefined && age < repoTtlMs) {
      return cached;
    }
    // What a request like this one found out a moment ago in another process: the same answer,
    // without asking the host again. A note from a clock that runs ahead is not believed longer.
    const missedAt = await findMissingRepo(database, coordinates);
    if (missedAt !== undefined) {
      const since = clock.now().getTime() - missedAt.getTime();
      if (since >= 0 && since < repoTtlMs) {
        this.#rememberMissing(name, missedAt.getTime() + repoTtlMs);
        throw new MountError("repo_not_found", "The repository was not found.");
      }
    }
    try {
      const repository = await gitHost.getRepository(coordinates);
      const saved = await saveRepository(database, coordinates, repository, clock.now());
      if (isAnonymouslyReadable(repository)) {
        return saved;
      }
      // Seen by a credential that sees more than the public does. It stays as invisible as any
      // other private repository, and is not asked about again for a while.
      if (remember) {
        await this.#noteMissing(coordinates, name);
      }
      throw new MountError("repo_not_found", "The repository was not found.");
    } catch (error) {
      if (!(error instanceof GitHostError)) {
        throw error;
      }
      if (error.kind === "not_found") {
        // Gone, or no longer public. A name that leads to a private repository keeps doing so
        // for the people who can see it; that is not this path's to forget. What was public is
        // written down as public no longer, so that nothing goes on listing it as it was.
        if (cached !== undefined) {
          await deleteRepoAlias(database, coordinates);
          await markRepositoryNotPublic(
            database,
            { accountId: cached.accountId, repoId: cached.id },
            clock.now(),
          );
        }
        if (remember) {
          await this.#noteMissing(coordinates, name);
        }
        throw new MountError("repo_not_found", "The repository was not found.", { cause: error });
      }
      if (cached !== undefined && age !== undefined && age < repoTtlMs + staleGraceMs) {
        return cached;
      }
      throw hostUnavailable(error);
    }
  }

  /**
   * What the name is to a person, asked of the git host as that person before anything is read:
   * someone who cannot see a repository learns nothing about it, not even by how long the answer
   * takes. Only what they can see is then read through the app's installation. `known` is what
   * they were let read under the name before, when there is such a thing. `undefined` when the
   * host shows them nothing under the name, or the app cannot read what it shows them.
   */
  async #resolvePrivate(
    coordinates: RepoCoordinates,
    user: UserRecord,
    permissions: RepoPermissions,
    known: RepoAliasRecord | undefined,
  ): Promise<RepoRecord | undefined> {
    const { database, gitHost, clock, repoTtlMs, staleGraceMs } = this.#options;
    const visible = await permissions.visibleRepository(user, coordinates);
    if (visible === undefined) {
      // What they were let read before is theirs no longer.
      if (known !== undefined) {
        await permissions.remember(user, known, false);
      }
      return undefined;
    }
    const ageOf = (record: RepoAliasRecord): number =>
      clock.now().getTime() - record.checkedAt.getTime();
    // The very repository whose facts were read a moment ago: nothing to read again.
    if (
      known !== undefined &&
      ageOf(known) < repoTtlMs &&
      known.repository.hostRepoId === visible
    ) {
      await permissions.remember(user, known, true);
      return known;
    }
    try {
      const repository = await gitHost.getRepository({
        ...coordinates,
        credential: "installation",
      });
      const saved = await saveRepository(database, coordinates, repository, clock.now());
      // The name has to mean to the app what it means to the person: a rename in between is a
      // repository nobody was asked about.
      const allowed = repository.hostRepoId === visible;
      await permissions.remember(user, saved, allowed);
      return allowed ? saved : undefined;
    } catch (error) {
      if (!(error instanceof GitHostError)) {
        throw error;
      }
      // Only someone the host shows the repository to gets this far, so what is kept about the
      // name may be looked at without telling anyone anything.
      const cached = known ?? (await findRepoByAlias(database, coordinates));
      if (error.kind === "not_found") {
        // The app is not installed there, or not any more: what it read is no longer the name's.
        if (cached !== undefined && !isAnonymouslyReadable(cached.repository)) {
          await deleteRepoAlias(database, coordinates);
        }
        return undefined;
      }
      if (
        cached !== undefined &&
        ageOf(cached) < repoTtlMs + staleGraceMs &&
        cached.repository.hostRepoId === visible
      ) {
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
  ): Promise<ResolvedCommit> {
    const { database, gitHost, clock, refTtlMs, staleGraceMs } = this.#options;
    const scope = { accountId: repo.accountId, repoId: repo.id };
    const cached = await findCachedRef(database, scope, refKey);
    const pinned = address.ref?.kind === "commit";
    const trustedUntil = (checkedAt: Date): Date | undefined =>
      pinned ? undefined : new Date(checkedAt.getTime() + refTtlMs);
    const age =
      cached === undefined ? undefined : clock.now().getTime() - cached.checkedAt.getTime();
    // A pinned commit that the host confirmed once is confirmed for good.
    if (cached !== undefined && (pinned || (age !== undefined && age < refTtlMs))) {
      return { commit: cached.commitSha, trustedUntil: trustedUntil(cached.checkedAt) };
    }
    try {
      const commit = await gitHost.resolveRef(coordinates, address.ref);
      const now = clock.now();
      await saveCachedRef(database, scope, refKey, commit, now);
      return { commit, trustedUntil: trustedUntil(now) };
    } catch (error) {
      if (!(error instanceof GitHostError)) {
        throw error;
      }
      if (error.kind === "not_found" || error.kind === "invalid") {
        throw refNotFound(address);
      }
      if (cached !== undefined && age !== undefined && age < refTtlMs + staleGraceMs) {
        // Served on borrowed time: nothing downstream should keep it longer than now.
        return { commit: cached.commitSha, trustedUntil: pinned ? undefined : clock.now() };
      }
      throw hostUnavailable(error);
    }
  }

  /**
   * Notes that the name is nothing to the public, for this process and, through the database,
   * for every other one. Only a question from nobody in particular gets here.
   */
  async #noteMissing(coordinates: RepoCoordinates, name: string): Promise<void> {
    const { database, clock, repoTtlMs } = this.#options;
    const now = clock.now();
    this.#rememberMissing(name, now.getTime() + repoTtlMs);
    await saveMissingRepo(
      database,
      { host: coordinates.host, owner: coordinates.owner, repo: coordinates.repo },
      now,
    );
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
