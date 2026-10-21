import { and, eq, isNotNull, ne, notExists, or, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { repoRefs, sectionVectors, snapshotEmbeddings, snapshots } from "../schema.js";
import type { SnapshotScope } from "./snapshots.js";
import type { VectorKey } from "./vectors.js";

// How far each snapshot's sections have been embedded under a key (ADR-0064): what the worker
// writes down as it goes, what tells it which served snapshots are still to be embedded under the
// configured model, and what goes when a model is replaced.

export interface SnapshotEmbeddingRecord {
  readonly snapshotId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly sectioningVersion: number;
  readonly bodies: number;
  readonly sections: number;
  readonly tokens: number;
  /** Null while the snapshot is still being embedded. */
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
}

/** What one slice of the work did to a snapshot's embedding. */
export interface EmbeddingProgress {
  readonly bodies: number;
  readonly sections: number;
  readonly tokens: number;
  /** True when this slice was the snapshot's last. */
  readonly completed: boolean;
}

const underKey = (key: VectorKey) =>
  and(
    eq(snapshotEmbeddings.model, key.model),
    eq(snapshotEmbeddings.dimensions, key.dimensions),
    eq(snapshotEmbeddings.sectioningVersion, key.sectioningVersion),
  );

/**
 * Adds what a slice did to the snapshot's row under the key, making the row when it is the first
 * slice, and marks the row complete when the slice says so. A completion is never undone: a
 * later slice over a snapshot that was complete adds its counts and leaves the mark.
 */
export async function recordSnapshotEmbedding(
  database: Database,
  scope: SnapshotScope,
  key: VectorKey,
  progress: EmbeddingProgress,
  now: Date,
): Promise<void> {
  const completedAt = progress.completed ? now : null;
  await drizzleOf(database)
    .insert(snapshotEmbeddings)
    .values({
      snapshotId: scope.snapshotId,
      accountId: scope.accountId,
      model: key.model,
      dimensions: key.dimensions,
      sectioningVersion: key.sectioningVersion,
      bodies: progress.bodies,
      sections: progress.sections,
      tokens: progress.tokens,
      completedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        snapshotEmbeddings.snapshotId,
        snapshotEmbeddings.model,
        snapshotEmbeddings.dimensions,
        snapshotEmbeddings.sectioningVersion,
      ],
      set: {
        bodies: sql`${snapshotEmbeddings.bodies} + excluded.bodies`,
        sections: sql`${snapshotEmbeddings.sections} + excluded.sections`,
        tokens: sql`${snapshotEmbeddings.tokens} + excluded.tokens`,
        completedAt: sql`coalesce(${snapshotEmbeddings.completedAt}, excluded.completed_at)`,
        updatedAt: now,
      },
    });
}

/** The snapshot's embedding under the key, when a slice has been written. */
export async function getSnapshotEmbedding(
  database: Database,
  scope: SnapshotScope,
  key: VectorKey,
): Promise<SnapshotEmbeddingRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      snapshotId: snapshotEmbeddings.snapshotId,
      model: snapshotEmbeddings.model,
      dimensions: snapshotEmbeddings.dimensions,
      sectioningVersion: snapshotEmbeddings.sectioningVersion,
      bodies: snapshotEmbeddings.bodies,
      sections: snapshotEmbeddings.sections,
      tokens: snapshotEmbeddings.tokens,
      completedAt: snapshotEmbeddings.completedAt,
      updatedAt: snapshotEmbeddings.updatedAt,
    })
    .from(snapshotEmbeddings)
    .where(
      and(
        eq(snapshotEmbeddings.snapshotId, scope.snapshotId),
        eq(snapshotEmbeddings.accountId, scope.accountId),
        underKey(key),
      ),
    )
    .limit(1);
  return row;
}

/** A snapshot the worker has still to embed under a key. */
export interface SnapshotToEmbed {
  readonly accountId: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
}

/**
 * The snapshots served right now, the ready index of the commit some ref of the repository points
 * at, that have no complete embedding under the key: the backfill after a change of model, and
 * whatever the queue lost. Newest index first, at most `limit`.
 */
export async function listSnapshotsToEmbed(
  database: Database,
  key: VectorKey,
  limit: number,
): Promise<SnapshotToEmbed[]> {
  const db = drizzleOf(database);
  const rows = await db
    .selectDistinct({
      accountId: snapshots.accountId,
      repoId: snapshots.repoId,
      snapshotId: snapshots.id,
      commitSha: snapshots.commitSha,
      indexedAt: snapshots.indexedAt,
    })
    .from(snapshots)
    .innerJoin(
      repoRefs,
      and(eq(repoRefs.repoId, snapshots.repoId), eq(repoRefs.commitSha, snapshots.commitSha)),
    )
    .where(
      and(
        eq(snapshots.status, "ready"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(snapshotEmbeddings)
            .where(
              and(
                eq(snapshotEmbeddings.snapshotId, snapshots.id),
                underKey(key),
                isNotNull(snapshotEmbeddings.completedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(sql`${snapshots.indexedAt} desc nulls last`, snapshots.id)
    .limit(limit);
  return rows.map(({ accountId, repoId, snapshotId, commitSha }) => ({
    accountId,
    repoId,
    snapshotId,
    commitSha,
  }));
}

/** How many rows one statement removes, so that a large table goes in steps a live database bears. */
const DELETE_BATCH_SIZE = 5000;

/**
 * Drops what was embedded under every key but this one: the vectors of the sections, where the
 * table is, and the rows of the snapshots' embeddings. For after a change of model, once nothing
 * is left to embed under the new key (ADR-0065). Says how many rows of each went.
 */
export async function deleteEmbeddingsOutsideKey(
  database: Database,
  key: VectorKey,
): Promise<{ readonly vectors: number; readonly snapshots: number }> {
  const db = drizzleOf(database);
  const removedSnapshots = await db
    .delete(snapshotEmbeddings)
    .where(
      or(
        ne(snapshotEmbeddings.model, key.model),
        ne(snapshotEmbeddings.dimensions, key.dimensions),
        ne(snapshotEmbeddings.sectioningVersion, key.sectioningVersion),
      ),
    )
    .returning({ id: snapshotEmbeddings.snapshotId });
  const present = await db.execute<{ present: boolean }>(
    sql`select to_regclass('section_vectors') is not null as present`,
  );
  let vectors = 0;
  if (present.rows[0]?.present === true) {
    const otherKey = or(
      ne(sectionVectors.model, key.model),
      ne(sectionVectors.dimensions, key.dimensions),
      ne(sectionVectors.sectioningVersion, key.sectioningVersion),
    );
    while (true) {
      const batch = await db.execute<{ removed: number }>(sql`
        with doomed as (
          select ctid from ${sectionVectors}
          where ${otherKey}
          limit ${DELETE_BATCH_SIZE}
        ),
        gone as (
          delete from ${sectionVectors} where ctid in (select ctid from doomed) returning 1
        )
        select count(*)::integer as removed from gone
      `);
      const removed = Number(batch.rows[0]?.removed ?? 0);
      vectors += removed;
      if (removed < DELETE_BATCH_SIZE) {
        break;
      }
    }
  }
  return { vectors, snapshots: removedSnapshots.length };
}
