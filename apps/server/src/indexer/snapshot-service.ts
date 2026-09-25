import {
  type BlobStore,
  type Clock,
  DomainError,
  type GitHost,
  GitHostError,
  type IndexLimits,
  type UsageSink,
} from "@skillcdn/core";
import {
  claimSnapshot,
  type Database,
  ensureSnapshot,
  failSnapshot,
  getSnapshot,
  releaseSnapshot,
  renewSnapshotLease,
  type SnapshotRecord,
  type SnapshotScope,
  writeSnapshotIndex,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import { buildSnapshotIndex, INDEX_VERSION } from "./build-index.js";

export type SnapshotOutcome =
  | { readonly status: "ready"; readonly snapshot: SnapshotRecord }
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
    const { database, clock } = this.#options;
    let snapshot = await this.#ensureStarted(mount);
    const scope = { accountId: snapshot.accountId, snapshotId: snapshot.id };
    const deadline = clock.now().getTime() + budgetMs;

    while (true) {
      if (snapshot.status === "ready") {
        return { status: "ready", snapshot };
      }
      // A failure that is due for a retry was just claimed again by #ensureStarted; one that is
      // not due is reported, so that a broken repository does not make every call wait.
      if (snapshot.status === "failed") {
        return { status: "failed", errorCode: snapshot.errorCode ?? "unknown" };
      }
      const remaining = deadline - clock.now().getTime();
      if (remaining <= 0) {
        return { status: "indexing" };
      }
      const local = this.#running.get(snapshot.id)?.done;
      const pause = sleep(Math.min(remaining, this.#options.pollMs ?? 300));
      await (local === undefined ? pause : Promise.race([local, pause]));
      const latest = await getSnapshot(database, scope);
      if (latest === undefined) {
        return { status: "failed", errorCode: "snapshot.missing" };
      }
      snapshot = latest;
      if (snapshot.status === "pending") {
        // Released by a process that shut down, or never claimed: try to pick it up.
        snapshot = await this.#ensureStarted(mount);
      }
    }
  }

  /** Resolves when the indexing that is running right now has finished, however it ends. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.#running.values()].map(({ done }) => done));
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
