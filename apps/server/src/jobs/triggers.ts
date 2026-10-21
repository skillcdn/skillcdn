import type { Clock } from "@skillcdn/core";
import {
  type Database,
  getSnapshotEmbedding,
  type JobQueue,
  type SnapshotRecord,
  type VectorKey,
} from "@skillcdn/db";
import type { IndexedSnapshot } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import { sendEmbedJob } from "./queues.js";
import { decideEmbedding, type EmbedPolicy, withinScope } from "./scope.js";

// When the api role queues the embedding of a snapshot (ADR-0064, point 4): the commits it
// indexes, as soon as their index is written, and the commits a search asks for that were never
// embedded, or not under the model in use, at the lowest priority. Both within the scope and the
// entitlements; the worker asks the same before it embeds.

/** How long a snapshot a search asked for is not looked at again by this process. */
const REMEMBER_SEARCHED_MS = 10 * 60_000;
const MAX_REMEMBERED = 5000;

export interface EmbedTriggerDependencies {
  readonly database: Database;
  readonly jobs: JobQueue;
  readonly key: VectorKey;
  readonly policy: EmbedPolicy;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly rememberMs?: number | undefined;
}

export interface EmbedTriggers {
  /** A commit this process just indexed: queued for the worker, where the repository may be embedded. */
  onIndexed(mount: Mount, snapshot: IndexedSnapshot): Promise<void>;
  /**
   * A snapshot a search by meaning just asked for: queued at the lowest priority when it has no
   * complete embedding under the key, so that a repository is embedded when it is first searched.
   * Never waits: the search goes on with what there is.
   */
  onSearched(mount: Mount, snapshot: SnapshotRecord): void;
}

export function createEmbedTriggers(deps: EmbedTriggerDependencies): EmbedTriggers {
  const { database, jobs, key, policy, clock, logger } = deps;
  const rememberMs = deps.rememberMs ?? REMEMBER_SEARCHED_MS;
  /** Snapshots looked at lately, by id, and until when they are not looked at again. */
  const remembered = new Map<string, number>();

  const remember = (id: string, until: number): void => {
    remembered.delete(id);
    remembered.set(id, until);
    if (remembered.size > MAX_REMEMBERED) {
      const oldest = remembered.keys().next().value;
      if (oldest !== undefined) {
        remembered.delete(oldest);
      }
    }
  };

  return {
    async onIndexed(mount, snapshot) {
      const decision = await decideEmbedding(policy, mount.repo.host, mount.repo.repository);
      if (!decision.allowed) {
        return;
      }
      await sendEmbedJob(jobs, { ...snapshot, key, reason: "indexed" });
    },
    onSearched(mount, snapshot) {
      if (!withinScope(policy.scope, mount.repo.repository.visibility)) {
        return;
      }
      const now = clock.now().getTime();
      const until = remembered.get(snapshot.id);
      if (until !== undefined && until > now) {
        return;
      }
      remember(snapshot.id, now + rememberMs);
      void (async () => {
        const record = await getSnapshotEmbedding(
          database,
          { accountId: snapshot.accountId, snapshotId: snapshot.id },
          key,
        );
        if (record?.completedAt != null) {
          return;
        }
        const decision = await decideEmbedding(policy, mount.repo.host, mount.repo.repository);
        if (!decision.allowed) {
          return;
        }
        await sendEmbedJob(jobs, {
          accountId: snapshot.accountId,
          repoId: snapshot.repoId,
          snapshotId: snapshot.id,
          commitSha: snapshot.commitSha,
          key,
          reason: "backfill",
        });
      })().catch((error: unknown) => {
        logger.warn(
          { err: error, snapshot: snapshot.id },
          "a searched snapshot could not be queued",
        );
      });
    },
  };
}
