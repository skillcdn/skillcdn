import type { BlobStore, Clock, Embedder } from "@skillcdn/core";
import {
  type Database,
  getSnapshotEmbedding,
  type JobQueue,
  recordSnapshotEmbedding,
  type SnapshotRecord,
  tierOfSnapshot,
  type VectorKey,
} from "@skillcdn/db";
import type { IndexedSnapshot } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import type { OperatorLists } from "../operator/lists.js";
import { reuseKnownVectors } from "./embed-snapshot.js";
import { sendEmbedJob } from "./queues.js";
import { decideEmbedding, type EmbedPolicy, withinScope } from "./scope.js";

// When the api role queues the embedding of a snapshot (ADR-0064, point 4; ADR-0072): the
// commits it indexes, as soon as their index is written, where the repository is one the worker
// embeds unasked, and the commits a search by meaning asks for that were never embedded, or not
// under the model in use, whatever the repository. Both within the scope and the entitlements,
// and at the priority of the repository's rank; the worker asks the same before it embeds.

/** How long a snapshot a search asked for is not looked at again by this process. */
const REMEMBER_SEARCHED_MS = 10 * 60_000;
const MAX_REMEMBERED = 5000;

export interface EmbedTriggerDependencies {
  readonly database: Database;
  readonly jobs: JobQueue;
  readonly key: VectorKey;
  readonly policy: EmbedPolicy;
  /** The operator's lists: what they name is embedded first. */
  readonly lists: Pick<OperatorLists, "listedKeys">;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly rememberMs?: number | undefined;
  /**
   * The bodies and how the embedder cuts a text, for the vectors a commit just indexed is given
   * from the texts it shares with what was embedded before (ADR-0107); left out, none are.
   */
  readonly reuse?:
    | {
        readonly blobs: Pick<BlobStore, "read">;
        readonly embedder: Pick<Embedder, "maxTextChars" | "maxTextTokens">;
      }
    | undefined;
}

export interface EmbedTriggers {
  /**
   * A commit this process just indexed: queued for the worker, where the repository may be
   * embedded and is one the worker embeds unasked; a repository that is no pack waits for a
   * search or a request.
   */
  onIndexed(mount: Mount, snapshot: IndexedSnapshot): Promise<void>;
  /**
   * A snapshot a search by meaning just asked for: queued when it has no complete embedding under
   * the key, so that a repository is embedded when it is first searched, whatever its rank. Never
   * waits: the search goes on with what there is.
   */
  onSearched(mount: Mount, snapshot: SnapshotRecord): void;
}

export function createEmbedTriggers(deps: EmbedTriggerDependencies): EmbedTriggers {
  const { database, jobs, key, policy, lists, clock, logger } = deps;
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
      const tier = await tierOfSnapshot(database, snapshot, await lists.listedKeys());
      if (tier === undefined || tier === "other") {
        return;
      }
      if (deps.reuse !== undefined) {
        // Before the job, which the worker may take at once: what it finds then is what is left.
        try {
          const reused = await reuseKnownVectors({ database, ...deps.reuse }, snapshot, key);
          if (reused.sections > 0) {
            logger.info(
              { snapshot: snapshot.snapshotId, ...reused },
              "a commit was given the vectors its texts had already",
            );
          }
          if (reused.left > 0) {
            // The embedding of the commit is under way from here, and not from the worker's
            // first slice (ADR-0126): a search says how far it is, and keeps an entry it has
            // not reached at the place the words gave it, while the job waits its turn.
            await recordSnapshotEmbedding(
              database,
              snapshot,
              key,
              { bodies: 0, sections: 0, tokens: 0, bytes: 0, completed: false },
              clock.now(),
            );
          }
        } catch (error) {
          logger.warn(
            { err: error, snapshot: snapshot.snapshotId },
            "the vectors a commit shares with the one before could not be given it",
          );
        }
      }
      await sendEmbedJob(jobs, { ...snapshot, key, reason: "indexed", tier });
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
        const scope = { accountId: snapshot.accountId, snapshotId: snapshot.id };
        const record = await getSnapshotEmbedding(database, scope, key);
        if (record?.completedAt != null) {
          return;
        }
        const decision = await decideEmbedding(policy, mount.repo.host, mount.repo.repository);
        if (!decision.allowed) {
          return;
        }
        const tier = await tierOfSnapshot(database, scope, await lists.listedKeys());
        if (tier === undefined) {
          return;
        }
        await sendEmbedJob(jobs, {
          ...scope,
          repoId: snapshot.repoId,
          commitSha: snapshot.commitSha,
          key,
          reason: "searched",
          tier,
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
