import {
  type Address,
  type Clock,
  formatAddress,
  LOCAL_HOST_KEY,
  parseAddress,
  ROOT_PATH,
} from "@skillcdn/core";
import {
  type Database,
  findSnapshotOfCommit,
  type JobQueue,
  listAliasNamesOfHost,
  listMovingRefs,
  listRepositoriesToIndexAhead,
} from "@skillcdn/db";
import { INDEX_VERSION } from "@skillcdn/indexer";
import type { IndexedSnapshot, SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { type Mount, MountError, type MountService } from "../mounts/mount-service.js";
import type { OperatorLists } from "../operator/lists.js";
import { type IndexJob, sendAheadJob } from "./queues.js";

// The worker indexing ahead of requests (ADR-0085). A pass, every minute, queues the
// repositories with a ref that is due: the git host announced a push, the host was not asked
// about the ref for the configured time, or the commit it points at has no index under the
// reading rules in force. A job then asks the host where the remembered refs of one repository
// point, as a request would, and indexes what has no index. Nothing a delivery says is believed
// (ADR-0038): the host is asked. A repository that is no pack, and a ref nobody ever asked for,
// are left to requests, as before; the packs of the deployment's own directory are found on
// disk, so that an installation's packs are indexed once they are copied in.

/** Which repositories the worker looks at when their time is up. */
export type AheadScope = "none" | "listed" | "packs";

export interface AheadConfig {
  /**
   * `listed`: the packs of the deployment's directory and the repositories the operator lists;
   * `packs`: every repository that is a pack; `none`: the worker indexes on request alone. A
   * push the host announces is followed for every pack unless it is `none`.
   */
  readonly scope: AheadScope;
  /** How long after the host was asked about a ref the worker asks again. */
  readonly intervalMs: number;
  /** How many repositories one pass queues. */
  readonly limit: number;
}

/** How many refs of one repository a job asks the host about: those asked of it last. */
export const AHEAD_REFS_PER_REPOSITORY = 10;
/** How long one attempt waits for an index before the queue tries the job again later. */
export const AHEAD_JOB_WAIT_MS = 10 * 60_000;
/** How long a host that limits its answers, or gives none, is left alone when it names no time. */
export const HOST_PAUSE_MS = 5 * 60_000;
/** How many packs of the directory one pass lists. */
export const DIRECTORY_PACKS_LIMIT = 2000;
const MAX_LEFT_ALONE = 10_000;

/** A pack of the deployment's directory, by the names of its address. */
export interface DirectoryPack {
  readonly owner: string;
  readonly name: string;
}

export interface IndexAheadDependencies {
  readonly database: Database;
  readonly jobs: JobQueue;
  readonly mounts: Pick<MountService, "resolve" | "resolveRepository">;
  readonly snapshots: Pick<SnapshotService, "ready">;
  /** The operator's lists: what they name is looked at on the schedule. */
  readonly lists: Pick<OperatorLists, "listedKeys">;
  readonly config: AheadConfig;
  /** The packs on disk under the deployment's directory; left out where it has none. */
  readonly directoryPacks?: ((limit: number) => Promise<readonly DirectoryPack[]>) | undefined;
  /** Queues the sections of a commit this worker found without an index; left out where nothing is embedded. */
  readonly onIndexed?: ((mount: Mount, snapshot: IndexedSnapshot) => Promise<void>) | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly waitMs?: number | undefined;
}

export interface LookOutcome {
  /** Repositories with a ref that is due, as the database names them. */
  readonly due: number;
  /** Packs on disk the deployment never saw. */
  readonly found: number;
  /** Jobs this pass queued; the rest had one waiting, or their host is left alone. */
  readonly queued: number;
}

export interface AheadOutcome {
  /** The refs the host was asked about. */
  readonly refs: number;
  /** Commits that had no index under the rules in force and have one now. */
  readonly indexed: number;
  /** Commits that could not be indexed: their snapshot retries on its own schedule. */
  readonly failed: number;
  /** Refs the host no longer has, or a repository the deployment does not serve. */
  readonly gone: number;
  /** True when the host could not be asked: it is left alone for a while, and the refs stay due. */
  readonly unanswered: boolean;
}

export interface IndexAhead {
  /** The pass: queues a job for every repository with a ref that is due. */
  look(): Promise<LookOutcome>;
  /** One repository: asks the host where its refs point, and indexes what has no index. */
  run(job: IndexJob): Promise<AheadOutcome>;
}

export function createIndexAhead(deps: IndexAheadDependencies): IndexAhead {
  const { database, jobs, mounts, snapshots, lists, config, clock, logger } = deps;
  /**
   * What is left alone, and until when: a host that limited its answers or gave none, by its
   * key, and a repository the deployment refuses to serve, by its row. Kept in the process: a
   * worker that starts asks once and learns it again.
   */
  const leftAlone = new Map<string, number>();
  const leave = (key: string, ms: number): void => {
    leftAlone.delete(key);
    leftAlone.set(key, clock.now().getTime() + ms);
    if (leftAlone.size > MAX_LEFT_ALONE) {
      const oldest = leftAlone.keys().next().value;
      if (oldest !== undefined) {
        leftAlone.delete(oldest);
      }
    }
  };
  const isLeftAlone = (key: string): boolean => {
    const until = leftAlone.get(key);
    if (until === undefined) {
      return false;
    }
    if (until > clock.now().getTime()) {
      return true;
    }
    leftAlone.delete(key);
    return false;
  };
  const hostKey = (host: string): string => `host ${host}`;
  const repoKey = (repoId: string): string => `repo ${repoId}`;

  return {
    async look() {
      const now = clock.now();
      const due = await listRepositoriesToIndexAhead(database, {
        now,
        staleBefore: new Date(now.getTime() - config.intervalMs),
        indexVersion: INDEX_VERSION,
        listed: await lists.listedKeys(),
        everyPack: config.scope === "packs",
        limit: config.limit,
      });
      let queued = 0;
      for (const repository of due) {
        if (isLeftAlone(hostKey(repository.host)) || isLeftAlone(repoKey(repository.repoId))) {
          continue;
        }
        // The names as the host spells them, read as an address reads them.
        const address = parseAddress(`/${repository.host}/${repository.owner}/${repository.name}`);
        if (!address.ok) {
          continue;
        }
        const sent = await sendAheadJob(
          jobs,
          {
            address: formatAddress(address.value),
            accountId: repository.accountId,
            repoId: repository.repoId,
          },
          repository.announced,
        );
        queued += sent ? 1 : 0;
      }
      // The packs on disk that were never asked for have no ref to be due: they are resolved as
      // anyone would resolve them, which makes them known, indexed and searched across packs.
      let found = 0;
      if (deps.directoryPacks !== undefined && !isLeftAlone(hostKey(LOCAL_HOST_KEY))) {
        const known = new Set(
          await listAliasNamesOfHost(database, LOCAL_HOST_KEY, DIRECTORY_PACKS_LIMIT * 2),
        );
        for (const pack of await deps.directoryPacks(DIRECTORY_PACKS_LIMIT)) {
          const name = `${pack.owner}/${pack.name}`.toLowerCase();
          if (known.has(name)) {
            continue;
          }
          found += 1;
          const sent = await sendAheadJob(jobs, { address: `/${LOCAL_HOST_KEY}/${name}` }, false);
          queued += sent ? 1 : 0;
        }
      }
      if (due.length > 0 || found > 0) {
        logger.info({ due: due.length, found, queued }, "looked ahead of requests");
      }
      return { due: due.length, found, queued };
    },

    async run(job) {
      const parsed = parseAddress(job.address);
      if (!parsed.ok) {
        throw new Error(`the job names no address: ${job.address}`);
      }
      const base = parsed.value;
      if (isLeftAlone(hostKey(base.host))) {
        // The queue tries the job again with its own delay; the pass sends none meanwhile.
        throw new Error("the git host is left alone for now");
      }
      const scope =
        job.accountId !== undefined && job.repoId !== undefined
          ? { accountId: job.accountId, repoId: job.repoId }
          : undefined;
      // A repository nobody resolved yet has its default branch to look at and nothing else.
      const refs =
        scope === undefined
          ? [""]
          : (await listMovingRefs(database, scope, AHEAD_REFS_PER_REPOSITORY)).map(
              (remembered) => remembered.ref,
            );
      let indexed = 0;
      let failed = 0;
      let gone = 0;
      let pending = 0;
      let unanswered = false;
      for (const ref of refs) {
        const address: Address = {
          ...base,
          ref: ref === "" ? undefined : { kind: "name", name: ref },
          path: ROOT_PATH,
        };
        let mount: Mount;
        try {
          mount =
            scope === undefined
              ? await mounts.resolve(address)
              : await mounts.resolveRepository(address, scope);
        } catch (error) {
          if (!(error instanceof MountError)) {
            throw error;
          }
          if (error.reason === "rate_limited" || error.reason === "unavailable") {
            leave(
              hostKey(base.host),
              Math.max(HOST_PAUSE_MS, (error.retryAfterSeconds ?? 0) * 1000),
            );
            throw error;
          }
          // A ref the host no longer has was forgotten by the resolution. A repository the
          // deployment does not serve, a blocked one among them, is left alone for a while.
          if (error.reason !== "ref_not_found" && scope !== undefined) {
            leave(repoKey(scope.repoId), Math.max(HOST_PAUSE_MS, config.intervalMs));
          }
          gone += 1;
          continue;
        }
        if (mount.borrowed === true) {
          // The host gave no answer, and what it said before stands in: there is nothing new to
          // index, and asking again every minute would only add to what keeps it from answering.
          leave(hostKey(base.host), HOST_PAUSE_MS);
          unanswered = true;
          break;
        }
        const repo = { accountId: mount.repo.accountId, repoId: mount.repo.id };
        const before = await findSnapshotOfCommit(database, repo, mount.commit);
        const had = before?.status === "ready" && before.indexVersion >= INDEX_VERSION;
        const outcome = await snapshots.ready(mount, deps.waitMs ?? AHEAD_JOB_WAIT_MS);
        if (outcome.status === "indexing") {
          pending += 1;
        } else if (outcome.status === "failed") {
          failed += 1;
        } else if (!had) {
          indexed += 1;
          await deps.onIndexed?.(mount, {
            accountId: outcome.snapshot.accountId,
            snapshotId: outcome.snapshot.id,
            repoId: outcome.snapshot.repoId,
            commitSha: outcome.snapshot.commitSha,
          });
        }
      }
      logger.info(
        { address: job.address, refs: refs.length, indexed, failed, gone, pending, unanswered },
        "repository looked at ahead of requests",
      );
      if (pending > 0) {
        throw new Error("a commit is still being indexed");
      }
      return { refs: refs.length, indexed, failed, gone, unanswered };
    },
  };
}
