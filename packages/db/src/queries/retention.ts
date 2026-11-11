import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { blobs, indexEntries, repoRefs, snapshots } from "../schema.js";
import { PINNED_REF_PREFIX } from "./repos.js";
import type { SnapshotScope } from "./snapshots.js";
import { deleteUnreferencedSectionVectors } from "./vectors.js";

// Which indexes are kept (ADR-0086): the index of a commit a ref of its repository points at, or
// pointed at last, for as long as the ref is remembered; any other index, a pinned commit's and
// a commit a ref moved on from, for a time after it was last read. What goes takes its entries
// and its embedding progress with it, and then the bodies and vectors nothing names any more.

/**
 * Notes that the index of a snapshot was read, at most once in `everyMs`: a write a read does
 * not wait for, and that most reads never make. True when the note was written.
 */
export async function touchSnapshot(
  database: Database,
  scope: SnapshotScope,
  now: Date,
  everyMs: number,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .update(snapshots)
    .set({ readAt: now })
    .where(
      and(
        eq(snapshots.id, scope.snapshotId),
        eq(snapshots.accountId, scope.accountId),
        sql`${snapshots.readAt} < ${new Date(now.getTime() - everyMs).toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: snapshots.id });
  return rows.length > 0;
}

export interface PruneOptions {
  readonly now: Date;
  /** An index nothing points at goes when it was neither read nor written since this instant. */
  readonly before: Date;
  /** How many snapshots one pass removes, the longest unread first. */
  readonly limit: number;
}

export interface PruneResult {
  readonly snapshots: number;
  /** Bodies no index entry of any repository references any more, after the snapshots went. */
  readonly blobs: number;
}

/**
 * Removes the indexes nothing keeps (ADR-0086), in one transaction: a snapshot no moving ref of
 * its repository points at or pointed at last, that nobody read and nothing wrote since
 * `before`, and that no process is indexing right now. With each go its entries, its embedding
 * progress, the note that its commit was confirmed as a pinned one, and then the bodies and the
 * vectors nothing references any more.
 */
export async function pruneSnapshots(
  database: Database,
  options: PruneOptions,
): Promise<PruneResult> {
  const now = sql`${options.now.toISOString()}::timestamptz`;
  const before = sql`${options.before.toISOString()}::timestamptz`;
  return drizzleOf(database).transaction(async (tx) => {
    const kept = sql`exists (select 1 from ${repoRefs} where ${repoRefs.repoId} = ${snapshots.repoId} and ${repoRefs.ref} not like ${`${PINNED_REF_PREFIX}%`} and (${repoRefs.commitSha} = ${snapshots.commitSha} or ${repoRefs.previousCommitSha} = ${snapshots.commitSha}))`;
    const going = await tx
      .select({ id: snapshots.id, repoId: snapshots.repoId, commitSha: snapshots.commitSha })
      .from(snapshots)
      .where(
        and(
          sql`not ${kept}`,
          sql`${snapshots.readAt} < ${before}`,
          sql`${snapshots.updatedAt} < ${before}`,
          sql`not (${snapshots.status} = 'indexing' and ${snapshots.leaseExpiresAt} > ${now})`,
        ),
      )
      .orderBy(snapshots.readAt, snapshots.id)
      .limit(options.limit)
      // Whoever claims or reads one of them meanwhile waits for this transaction, and finds the row gone.
      .for("update", { skipLocked: true });
    if (going.length === 0) {
      return { snapshots: 0, blobs: 0 };
    }
    const ids = going.map((row) => row.id);
    // The bodies these indexes referred to, noted before their entries go: only those can have
    // become unreferenced, and the table is shared with every other repository.
    const referred = await tx
      .selectDistinct({ sha: indexEntries.blobSha })
      .from(indexEntries)
      .where(inArray(indexEntries.snapshotId, ids));
    await tx.delete(snapshots).where(inArray(snapshots.id, ids));
    for (const row of going) {
      await tx
        .delete(repoRefs)
        .where(
          and(
            eq(repoRefs.repoId, row.repoId),
            eq(repoRefs.ref, `${PINNED_REF_PREFIX}${row.commitSha}`),
          ),
        );
    }
    const shas = referred.map((row) => row.sha);
    const unreferenced =
      shas.length === 0
        ? []
        : await tx
            .delete(blobs)
            .where(
              and(
                inArray(blobs.sha, shas),
                notExists(
                  tx
                    .select({ sha: indexEntries.blobSha })
                    .from(indexEntries)
                    .where(eq(indexEntries.blobSha, blobs.sha)),
                ),
              ),
            )
            .returning({ sha: blobs.sha });
    await deleteUnreferencedSectionVectors(tx, shas);
    return { snapshots: going.length, blobs: unreferenced.length };
  });
}
