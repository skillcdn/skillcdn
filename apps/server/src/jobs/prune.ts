import type { Clock } from "@skillcdn/core";
import { type Database, type PruneResult, pruneSnapshots } from "@skillcdn/db";
import type { Logger } from "../logger.js";

// Which indexes go (ADR-0086): the index of a commit that no ref of its repository points at or
// pointed at last, once nobody has read it for the configured time. A ref somebody asked for
// keeps its commit and the one before it for as long as it is remembered; a pinned commit, and
// a commit a ref moved on from, live by being read. Run hourly by the worker, a bounded number
// of indexes at a time, so that a backlog drains over the hours after it is turned on.

/** How many indexes one pass removes, the longest unread first. */
export const PRUNE_LIMIT = 500;

export interface PruneDependencies {
  readonly database: Database;
  readonly clock: Clock;
  /** How long an index nothing points at is kept after it was last read. */
  readonly retentionMs: number;
  readonly logger: Logger;
  readonly limit?: number | undefined;
}

export async function pruneIndexes(deps: PruneDependencies): Promise<PruneResult> {
  const now = deps.clock.now();
  const removed = await pruneSnapshots(deps.database, {
    now,
    before: new Date(now.getTime() - deps.retentionMs),
    limit: deps.limit ?? PRUNE_LIMIT,
  });
  if (removed.snapshots > 0) {
    deps.logger.info({ ...removed }, "indexes nothing points at and nobody read were removed");
  }
  return removed;
}
