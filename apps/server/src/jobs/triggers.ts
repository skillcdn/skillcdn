import type { BlobStore, Clock, Embedder } from "@skillcdn/core";
import {
  type Database,
  findSnapshotOfCommit,
  getSnapshotEmbedding,
  type JobQueue,
  type SnapshotRecord,
  type SnapshotScope,
  tierOfSnapshot,
  type VectorKey,
} from "@skillcdn/db";
import type { IndexedSnapshot } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import type { OperatorLists } from "../operator/lists.js";
import { beginEmbedding, bodiesLeftToEmbed, reuseKnownVectors } from "./embed-snapshot.js";
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
        /** How many bodies a commit is given vectors for at most; for tests. */
        readonly limit?: number | undefined;
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

  /**
   * Writes down how the embedding of a snapshot stands before its job is queued, with the bodies
   * left where the caller counted them. Where it cannot be written the worker's first slice
   * writes it, as it did.
   */
  const say = async (scope: SnapshotScope, counted: number | undefined): Promise<void> => {
    try {
      const left = counted ?? (await bodiesLeftToEmbed(database, scope, key));
      await beginEmbedding(database, scope, key, left, clock.now());
    } catch (error) {
      logger.warn(
        { err: error, snapshot: scope.snapshotId },
        "how the embedding of a commit stands could not be written down",
      );
    }
  };

  /**
   * The snapshot of the commit the mount's ref was at before the one just indexed: what tells
   * the bodies a commit changed from the ones its pack had waiting already (ADR-0132).
   */
  const snapshotBefore = async (
    mount: Mount,
    snapshot: IndexedSnapshot,
  ): Promise<SnapshotScope | undefined> => {
    const previous = mount.previousCommit;
    if (previous === undefined || previous === snapshot.commitSha) {
      return undefined;
    }
    const before = await findSnapshotOfCommit(
      database,
      { accountId: snapshot.accountId, repoId: snapshot.repoId },
      previous,
    );
    return before === undefined
      ? undefined
      : { accountId: before.accountId, snapshotId: before.id };
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
      // How the embedding stands is said before a vector is given and before the job is queued
      // (ADR-0126): the commit is served already, and a search in between would rank an entry
      // without its vectors behind every embedded one and say nothing of it. With a body left
      // it is under way, while the job waits its turn too; with none it is complete.
      if (deps.reuse === undefined) {
        await say(snapshot, undefined);
      } else {
        const counted: { left?: number } = {};
        // Before the job, which the worker may take at once: what it finds then is what is left.
        const { blobs, embedder, limit } = deps.reuse;
        const reused = await reuseKnownVectors({ database, blobs, embedder }, snapshot, key, {
          limit,
          before: () => snapshotBefore(mount, snapshot),
          begun: async (left) => {
            counted.left = left;
            await say(snapshot, left);
          },
        }).catch((error: unknown) => {
          logger.warn(
            { err: error, snapshot: snapshot.snapshotId },
            "the vectors a commit shares with the one before could not be given it",
          );
          return undefined;
        });
        if (reused !== undefined && reused.sections > 0) {
          logger.info(
            { snapshot: snapshot.snapshotId, ...reused },
            "a commit was given the vectors its texts had already",
          );
        }
        if (counted.left === undefined) {
          // The bodies could not be counted there: counted here, if they can be now.
          await say(snapshot, undefined);
        } else if (reused !== undefined && reused.left === 0 && counted.left > 0) {
          // Every body that was left was given its vectors: nothing waits for the worker.
          await say(snapshot, 0);
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
        // Under way from the moment it is queued, as a commit just indexed is.
        await say(scope, undefined);
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
