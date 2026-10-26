import {
  type BlobStore,
  type Clock,
  DomainError,
  type GitHost,
  GitHostError,
  type IndexLimits,
  type IndexSubstitute,
  type NewestCommit,
  type UsageSink,
} from "@skillcdn/core";
import {
  claimSnapshot,
  type Database,
  ensureSnapshot,
  failSnapshot,
  findSnapshotOfCommit,
  getSnapshot,
  releaseSnapshot,
  renewSnapshotLease,
  type SnapshotRecord,
  type SnapshotScope,
  writeSnapshotIndex,
} from "@skillcdn/db";
import { buildSnapshotIndex, INDEX_VERSION, MIN_SERVABLE_INDEX_VERSION } from "@skillcdn/indexer";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";

export type SnapshotOutcome =
  | { readonly status: "ready"; readonly snapshot: SnapshotRecord }
  | { readonly status: "indexing" }
  | { readonly status: "failed"; readonly errorCode: string };

/**
 * What a mount is served from (ADR-0068): the index of its commit, or, while that is not ready,
 * another served in its place, `substitute` saying which and why; or why there is nothing.
 */
export type ServingOutcome =
  | {
      readonly status: "ready";
      readonly snapshot: SnapshotRecord;
      readonly substitute?: IndexSubstitute | undefined;
    }
  | { readonly status: "indexing" }
  | { readonly status: "failed"; readonly errorCode: string };

export interface SnapshotServiceOptions {
  readonly database: Database;
  readonly gitHost: GitHost;
  readonly blobStore: BlobStore;
  readonly clock: Clock;
  readonly usage: UsageSink;
  readonly logger: Logger;
  readonly limits: IndexLimits;
  /** Indexing runs at once in this process. More than that stays pending for someone else. */
  readonly concurrency: number;
  readonly leaseMs: number;
  /** A token for each claim, which nothing else must be able to guess or repeat. */
  readonly newLeaseOwner: () => string;
  /** How often a waiting request looks at the database. */
  readonly pollMs?: number;
  /**
   * The lowest version of the reading rules whose index is served while a commit's index is
   * rebuilt under newer ones (ADR-0068): the indexer's floor, unless a test says otherwise.
   */
  readonly minServableIndexVersion?: number | undefined;
  /**
   * What follows an index this process wrote: the embedding of its sections, queued for the
   * worker (ADR-0064). A failure here is logged and the index stands; the worker's sweep finds
   * what was not queued.
   */
  readonly onIndexed?: ((mount: Mount, snapshot: IndexedSnapshot) => Promise<void>) | undefined;
}

/** A snapshot this process just indexed, as what follows it needs it named. */
export interface IndexedSnapshot extends SnapshotScope {
  readonly repoId: string;
  readonly commitSha: string;
}

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 3_600_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Builds indexes lazily, inside the api process. The snapshot row is the source of truth: a claim
 * on it decides who indexes, across every replica, and a request only ever waits on the row. When
 * the worker role arrives it takes over the claiming; nothing else has to change.
 */
export class SnapshotService {
  readonly #options: SnapshotServiceOptions;
  readonly #running = new Map<string, { done: Promise<void>; abort: AbortController }>();
  /** The starts in flight: a snapshot row being made or claimed, before anything runs for it. */
  readonly #starting = new Set<Promise<SnapshotRecord>>();
  #closing = false;

  constructor(options: SnapshotServiceOptions) {
    this.#options = options;
  }

  /** Makes sure indexing of the mount's commit has started, without waiting for it. */
  async warm(mount: Mount): Promise<void> {
    await this.#ensureStarted(mount);
  }

  /**
   * The index for a mount, waiting up to `budgetMs` for it to be built. Past the budget the
   * answer is `indexing`, and indexing continues.
   */
  async ready(mount: Mount, budgetMs: number): Promise<SnapshotOutcome> {
    return (await this.#await(mount, budgetMs)).outcome;
  }

  /**
   * What the mount is served from (ADR-0068): the index of its commit when that is ready within
   * the budget; else, for a moving ref, the commit's own index under the previous reading rules
   * while it is rebuilt, or the index of the ref's previous commit, each with the newest commit's
   * state beside it; else why there is nothing to serve. A pinned address is its commit alone.
   * A mount that may not start indexing (ADR-0074) is served what is there, without waiting.
   */
  async serving(mount: Mount, budgetMs: number): Promise<ServingOutcome> {
    const { outcome, snapshot } =
      mount.startsIndexing === false ? await this.#held(mount) : await this.#await(mount, budgetMs);
    if (outcome.status === "ready" || mount.address.ref?.kind === "commit") {
      return outcome;
    }
    const newest: NewestCommit =
      outcome.status === "indexing"
        ? { commit: mount.commit, status: "indexing" }
        : { commit: mount.commit, status: "failed", errorCode: outcome.errorCode };
    const floor = Math.max(1, this.#options.minServableIndexVersion ?? MIN_SERVABLE_INDEX_VERSION);
    // The commit's own index under the rules before: a rebuild replaces its entries in one
    // transaction, so until then they are the index that was served a moment ago.
    if (snapshot !== undefined && snapshot.indexVersion >= floor) {
      return { status: "ready", snapshot, substitute: { commit: snapshot.commitSha, newest } };
    }
    const previous = mount.previousCommit;
    if (previous === undefined || previous === mount.commit) {
      return outcome;
    }
    const last = await findSnapshotOfCommit(
      this.#options.database,
      { accountId: mount.repo.accountId, repoId: mount.repo.id },
      previous,
    );
    if (last === undefined || last.indexVersion < floor) {
      return outcome;
    }
    return { status: "ready", snapshot: last, substitute: { commit: last.commitSha, newest } };
  }

  /**
   * The outcome for a mount as the database holds its commit, starting and claiming nothing: a
   * commit never started, or being built, is `indexing` to whoever reads it this way, and what
   * its row holds may still be served in its place.
   */
  async #held(
    mount: Mount,
  ): Promise<{ readonly outcome: SnapshotOutcome; readonly snapshot: SnapshotRecord | undefined }> {
    const snapshot = await findSnapshotOfCommit(
      this.#options.database,
      { accountId: mount.repo.accountId, repoId: mount.repo.id },
      mount.commit,
    );
    if (snapshot?.status === "ready" && snapshot.indexVersion >= INDEX_VERSION) {
      return { outcome: { status: "ready", snapshot }, snapshot };
    }
    if (snapshot?.status === "failed") {
      return {
        outcome: { status: "failed", errorCode: snapshot.errorCode ?? "unknown" },
        snapshot,
      };
    }
    return { outcome: { status: "indexing" }, snapshot };
  }

  /** The outcome for a mount within the budget, with the last state seen of its own snapshot. */
  async #await(
    mount: Mount,
    budgetMs: number,
  ): Promise<{ readonly outcome: SnapshotOutcome; readonly snapshot: SnapshotRecord | undefined }> {
    const { database, clock } = this.#options;
    let snapshot = await this.#ensureStarted(mount);
    const scope = { accountId: snapshot.accountId, snapshotId: snapshot.id };
    const deadline = clock.now().getTime() + budgetMs;

    while (true) {
      if (snapshot.status === "ready") {
        return { outcome: { status: "ready", snapshot }, snapshot };
      }
      // A failure that is due for a retry was just claimed again by #ensureStarted; one that is
      // not due is reported, so that a broken repository does not make every call wait.
      if (snapshot.status === "failed") {
        return {
          outcome: { status: "failed", errorCode: snapshot.errorCode ?? "unknown" },
          snapshot,
        };
      }
      const remaining = deadline - clock.now().getTime();
      if (remaining <= 0) {
        return { outcome: { status: "indexing" }, snapshot };
      }
      const local = this.#running.get(snapshot.id)?.done;
      const pause = sleep(Math.min(remaining, this.#options.pollMs ?? 300));
      await (local === undefined ? pause : Promise.race([local, pause]));
      const latest = await getSnapshot(database, scope);
      if (latest === undefined) {
        return {
          outcome: { status: "failed", errorCode: "snapshot.missing" },
          snapshot: undefined,
        };
      }
      snapshot = latest;
      if (snapshot.status === "pending") {
        // Released by a process that shut down, or never claimed: try to pick it up.
        snapshot = await this.#ensureStarted(mount);
      }
    }
  }

  /**
   * Resolves when the indexing that is running right now has finished, however it ends, and
   * when nothing is about to start: a request starts indexing without waiting for it, so a start
   * may still be claiming its row when the response is out, and what it starts counts as running.
   */
  async idle(): Promise<void> {
    while (this.#starting.size > 0 || this.#running.size > 0) {
      await Promise.allSettled([
        ...this.#starting,
        ...[...this.#running.values()].map(({ done }) => done),
      ]);
    }
  }

  /** Stops claiming, aborts what is running and hands the rows back for another process. */
  async close(): Promise<void> {
    this.#closing = true;
    for (const { abort } of this.#running.values()) {
      abort.abort(new DOMException("shutting down", "AbortError"));
    }
    await Promise.allSettled([...this.#running.values()].map(({ done }) => done));
  }

  async #ensureStarted(mount: Mount): Promise<SnapshotRecord> {
    const pending = this.#start(mount);
    this.#starting.add(pending);
    try {
      return await pending;
    } finally {
      this.#starting.delete(pending);
    }
  }

  async #start(mount: Mount): Promise<SnapshotRecord> {
    const { database, clock, concurrency, leaseMs } = this.#options;
    const snapshot = await ensureSnapshot(
      database,
      { accountId: mount.repo.accountId, repoId: mount.repo.id },
      mount.commit,
      INDEX_VERSION,
      clock.now(),
    );
    if (
      snapshot.status === "ready" ||
      this.#closing ||
      this.#running.has(snapshot.id) ||
      this.#running.size >= concurrency
    ) {
      return snapshot;
    }
    const scope = { accountId: snapshot.accountId, snapshotId: snapshot.id };
    const owner = this.#options.newLeaseOwner();
    const claimed = await claimSnapshot(database, scope, owner, clock.now(), leaseMs);
    if (claimed === undefined) {
      return snapshot;
    }
    const abort = new AbortController();
    const done = this.#index(mount, scope, owner, abort.signal)
      .catch((error: unknown) => {
        // Indexing records its own failures. Whatever still escapes, such as the database going
        // away while a failure is recorded, must not become an unhandled rejection.
        this.#options.logger.error(
          { err: error, snapshot: snapshot.id },
          "indexing failed outside its own handling",
        );
      })
      .finally(() => {
        this.#running.delete(snapshot.id);
      });
    this.#running.set(snapshot.id, { done, abort });
    return claimed;
  }

  async #index(
    mount: Mount,
    scope: SnapshotScope,
    owner: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { database, gitHost, blobStore, clock, usage, logger, leaseMs } = this.#options;
    const log = logger.child({
      repo: `${mount.coordinates.owner}/${mount.coordinates.repo}`,
      commit: mount.commit,
      account: mount.repo.accountId,
    });
    const started = clock.now().getTime();
    const renewal = setInterval(() => {
      renewSnapshotLease(database, scope, owner, clock.now(), leaseMs).catch((error: unknown) => {
        log.warn({ err: error }, "could not renew the indexing lease");
      });
    }, leaseMs / 3);

    try {
      const index = await buildSnapshotIndex({
        gitHost,
        blobStore,
        coordinates: mount.coordinates,
        repository: {
          host: mount.coordinates.host,
          owner: mount.repo.repository.owner.login,
          name: mount.repo.repository.name,
        },
        commit: mount.commit,
        limits: { ...this.#options.limits, ...mount.limits },
        signal,
      });
      signal.throwIfAborted();
      const written = await writeSnapshotIndex(database, scope, owner, index, clock.now());
      if (!written) {
        log.warn("lost the indexing lease before the index was written");
        return;
      }
      const searchable = index.entries.filter((entry) => entry.searchable).length;
      log.info(
        {
          files: index.entries.length,
          searchable,
          truncated: index.truncated,
          skipped: index.diagnostics.length,
          ms: clock.now().getTime() - started,
        },
        "indexed",
      );
      usage.record({
        type: "index_completed",
        at: clock.now(),
        hostAccountId: mount.repo.repository.owner.hostAccountId,
        hostRepoId: mount.repo.repository.hostRepoId,
        subject: "index",
        quantity: searchable,
        unit: "file",
      });
      if (this.#options.onIndexed !== undefined) {
        try {
          await this.#options.onIndexed(mount, {
            ...scope,
            repoId: mount.repo.id,
            commitSha: mount.commit,
          });
        } catch (error) {
          log.warn({ err: error }, "what follows the index could not be queued");
        }
      }
    } catch (error) {
      if (signal.aborted) {
        await releaseSnapshot(database, scope, owner, clock.now()).catch(() => {});
        log.info("indexing interrupted; the snapshot was handed back");
        return;
      }
      const attempts = await getSnapshot(database, scope).then(
        (row) => row?.attempts ?? 1,
        () => 1,
      );
      const hinted = error instanceof GitHostError ? error.retryAfterSeconds : undefined;
      const backoff = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);
      const retryInMs = Math.max(backoff, (hinted ?? 0) * 1000);
      const errorCode = error instanceof DomainError ? error.code : "indexer.failed";
      await failSnapshot(database, scope, owner, {
        errorCode,
        retryAt: new Date(clock.now().getTime() + retryInMs),
        now: clock.now(),
      }).catch(() => {});
      log.error({ err: error, errorCode, retryInMs }, "indexing failed");
    } finally {
      clearInterval(renewal);
    }
  }
}
