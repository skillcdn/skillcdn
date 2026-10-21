import { type Clock, parseAddress } from "@skillcdn/core";
import type { JobQueue, VectorKey } from "@skillcdn/db";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import type { MountService } from "../mounts/mount-service.js";
import { type IndexJob, sendEmbedJob } from "./queues.js";

// The designated indexing of ADR-0064: a repository somebody asked for is resolved and indexed
// now, by the worker, and its sections are then embedded ahead of everything else. A repository
// that is not public is nobody's to designate here: the worker resolves as everyone sees the name.

/** How long one attempt waits for the index before the queue tries the job again later. */
export const INDEX_JOB_WAIT_MS = 10 * 60_000;

export interface IndexJobDependencies {
  readonly mounts: Pick<MountService, "resolve">;
  readonly snapshots: Pick<SnapshotService, "ready">;
  readonly jobs: JobQueue;
  /** The key to embed under; `undefined` where this worker embeds nothing. */
  readonly key: VectorKey | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly waitMs?: number | undefined;
}

export interface IndexJobOutcome {
  readonly commit: string;
  /** True when a slice of the embedding was queued; false when there is nothing to embed with, or it was queued already. */
  readonly queued: boolean;
}

export async function indexRepositoryJob(
  deps: IndexJobDependencies,
  job: IndexJob,
): Promise<IndexJobOutcome> {
  const parsed = parseAddress(job.address);
  if (!parsed.ok) {
    throw new Error(`the job names no address: ${job.address}`);
  }
  const mount = await deps.mounts.resolve(parsed.value);
  const outcome = await deps.snapshots.ready(mount, deps.waitMs ?? INDEX_JOB_WAIT_MS);
  if (outcome.status === "indexing") {
    throw new Error("the commit is still being indexed");
  }
  if (outcome.status === "failed") {
    throw new Error(`the commit could not be indexed: ${outcome.errorCode}`);
  }
  const { snapshot } = outcome;
  const queued =
    deps.key === undefined
      ? false
      : await sendEmbedJob(deps.jobs, {
          accountId: snapshot.accountId,
          repoId: snapshot.repoId,
          snapshotId: snapshot.id,
          commitSha: snapshot.commitSha,
          key: deps.key,
          reason: "designated",
        });
  deps.logger.info(
    { address: job.address, commit: mount.commit, queued },
    "repository indexed on request",
  );
  return { commit: mount.commit, queued };
}
