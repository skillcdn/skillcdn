import {
  type Database,
  deleteEmbeddingsOutsideKey,
  type JobQueue,
  listSnapshotsToEmbed,
  type VectorKey,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { sendEmbedJob } from "./queues.js";

// The sweep (ADR-0064, ADR-0065): what is served and not yet embedded under the configured key
// is queued at the lowest priority, which after a change of model is every served snapshot, the
// backfill; and once nothing is left to embed, what was embedded under other keys goes.

/** How many snapshots one sweep queues: the rest wait for the next, an hour on. */
export const SWEEP_LIMIT = 1000;

export interface SweepDependencies {
  readonly database: Database;
  readonly jobs: JobQueue;
  readonly key: VectorKey;
  readonly logger: Logger;
  readonly limit?: number | undefined;
}

export interface SweepOutcome {
  /** Served snapshots without a complete embedding under the key. */
  readonly pending: number;
  /** How many of them this sweep queued; the others were queued already. */
  readonly queued: number;
  /** What went of other keys, when nothing was pending. */
  readonly dropped: { readonly vectors: number; readonly snapshots: number } | undefined;
}

export async function sweepEmbeddings(deps: SweepDependencies): Promise<SweepOutcome> {
  const { database, jobs, key } = deps;
  const pending = await listSnapshotsToEmbed(database, key, deps.limit ?? SWEEP_LIMIT);
  let queued = 0;
  for (const snapshot of pending) {
    if (await sendEmbedJob(jobs, { ...snapshot, key, reason: "backfill" })) {
      queued += 1;
    }
  }
  // A model replaced: its vectors are dropped only once everything is embedded under the new one,
  // so that a search never finds less than it did before the change.
  const dropped =
    pending.length === 0 ? await deleteEmbeddingsOutsideKey(database, key) : undefined;
  deps.logger.info(
    { model: key.model, pending: pending.length, queued, dropped },
    "embeddings swept",
  );
  return { pending: pending.length, queued, dropped };
}
