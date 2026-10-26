import { LOCAL_HOST_KEY } from "@skillcdn/core";
import { and, eq, gte, isNotNull, lte, ne, notExists, or, type SQL, sql } from "drizzle-orm";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import {
  accounts,
  embeddingUsageDaily,
  indexEntries,
  repoRefs,
  repos,
  sectionVectors,
  snapshotEmbeddings,
  snapshots,
} from "../schema.js";
import type { RepoScope } from "./repos.js";
import type { SnapshotScope } from "./snapshots.js";
import type { UsageDay } from "./usage.js";
import type { VectorKey } from "./vectors.js";

// How far each snapshot's sections have been embedded under a key (ADR-0064): what the worker
// writes down as it goes, what tells it which served snapshots are still to be embedded under the
// configured model, what the bounds of the embedding are measured against, and what goes when a
// model is replaced.

export interface SnapshotEmbeddingRecord {
  readonly snapshotId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly sectioningVersion: number;
  readonly bodies: number;
  readonly sections: number;
  readonly tokens: number;
  /** The bytes of the bodies written. */
  readonly bytes: number;
  /** Null while the snapshot is still being embedded. */
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
}

/** What one slice of the work did to a snapshot's embedding. */
export interface EmbeddingProgress {
  readonly bodies: number;
  readonly sections: number;
  readonly tokens: number;
  /** The bytes of the bodies written. */
  readonly bytes: number;
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
      bytes: progress.bytes,
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
        bytes: sql`${snapshotEmbeddings.bytes} + excluded.bytes`,
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
      bytes: snapshotEmbeddings.bytes,
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

/**
 * The bytes of the bodies embedded for a repository under the key, over every snapshot of it:
 * what a bound per repository is held against. A body shared by two commits was written once and
 * counts once.
 */
export async function embeddedBytesOfRepository(
  database: Database,
  scope: RepoScope,
  key: VectorKey,
): Promise<number> {
  const [row] = await drizzleOf(database)
    .select({ bytes: sql<string>`coalesce(sum(${snapshotEmbeddings.bytes}), 0)` })
    .from(snapshotEmbeddings)
    .innerJoin(snapshots, eq(snapshots.id, snapshotEmbeddings.snapshotId))
    .where(
      and(
        eq(snapshots.repoId, scope.repoId),
        eq(snapshotEmbeddings.accountId, scope.accountId),
        underKey(key),
      ),
    );
  return Number(row?.bytes ?? 0);
}

/** What was embedded for an account on one day. */
export interface EmbeddingUsage {
  readonly bytes: number;
  readonly sections: number;
  readonly tokens: number;
}

/** Adds what a slice embedded to the account's day, making the row when it is the first. */
export async function addEmbeddingUsage(
  database: Database,
  accountId: string,
  day: UsageDay,
  delta: EmbeddingUsage,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .insert(embeddingUsageDaily)
    .values({
      accountId,
      day,
      bytes: delta.bytes,
      sections: delta.sections,
      tokens: delta.tokens,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [embeddingUsageDaily.accountId, embeddingUsageDaily.day],
      set: {
        bytes: sql`${embeddingUsageDaily.bytes} + excluded.bytes`,
        sections: sql`${embeddingUsageDaily.sections} + excluded.sections`,
        tokens: sql`${embeddingUsageDaily.tokens} + excluded.tokens`,
        updatedAt: now,
      },
    });
}

/** What was embedded for an account on one day; nothing when nothing was. */
export async function getEmbeddingUsage(
  database: Database,
  accountId: string,
  day: UsageDay,
): Promise<EmbeddingUsage | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      bytes: embeddingUsageDaily.bytes,
      sections: embeddingUsageDaily.sections,
      tokens: embeddingUsageDaily.tokens,
    })
    .from(embeddingUsageDaily)
    .where(and(eq(embeddingUsageDaily.accountId, accountId), eq(embeddingUsageDaily.day, day)))
    .limit(1);
  return row;
}

/**
 * The rank of a repository among what the worker embeds unasked (ADR-0072), first to last:
 * `listed`, the operator lists the repository or it is a pack of the deployment's own directory;
 * `declared`, its index holds a manifest, or the repository is private and the deployment embeds
 * those; `skills`, its index holds a skill; `other`, none of these, which is embedded only when a
 * search or a request asks for it.
 */
export const EMBED_TIERS = ["listed", "declared", "skills", "other"] as const;
export type EmbedTier = (typeof EMBED_TIERS)[number];

/** The tier at a place of {@link EMBED_TIERS}, as a rank computed in SQL names it. */
const tierAt = (rank: number): EmbedTier => EMBED_TIERS[Number(rank)] ?? "other";

/**
 * The rank of the snapshot's repository as the place of its tier in {@link EMBED_TIERS}, computed
 * in SQL so that a list is ordered and cut by it. `listed` holds the repositories the operator
 * lists as `/gh/owner/repo`; the comparison ignores case, as a git host does. Over `snapshots`
 * joined with `repos` and `accounts`.
 */
function rankOf(listed: readonly string[]): SQL<number> {
  const keys = sql.param(listed.map((key) => key.toLowerCase()));
  const key = sql`lower('/' || ${repos.host} || '/' || ${accounts.login} || '/' || ${repos.name})`;
  const holds = (kind: "manifest" | "skill") =>
    sql`exists (select 1 from ${indexEntries} where ${indexEntries.snapshotId} = ${snapshots.id} and ${indexEntries.kind} = ${kind})`;
  return sql<number>`case
    when ${repos.host} = ${LOCAL_HOST_KEY} or ${key} = any(${keys}::text[]) then 0
    when ${repos.visibility} = 'private' or ${holds("manifest")} then 1
    when ${holds("skill")} then 2
    else 3
  end`;
}

/** A snapshot the worker has still to embed under a key. */
export interface SnapshotToEmbed {
  readonly accountId: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  /** The rank of its repository; never `other`, which the sweep leaves to a search. */
  readonly tier: EmbedTier;
}

export interface SnapshotsToEmbedOptions {
  /** Only the snapshots of public repositories; left out, of every repository. */
  readonly visibility?: "public" | undefined;
  /** The repositories the operator lists, `/gh/owner/repo` each; none when left out. */
  readonly listed?: readonly string[] | undefined;
}

/**
 * What the sweep has still to embed under the key: a ready snapshot of the commit some ref of
 * its repository points at, so served right now, within the visibility, without a complete
 * embedding under the key, and of a repository the worker embeds unasked, which leaves `other`
 * out.
 */
function toEmbed(
  db: Drizzle,
  key: VectorKey,
  rank: SQL<number>,
  options: SnapshotsToEmbedOptions,
): SQL | undefined {
  return and(
    eq(snapshots.status, "ready"),
    sql`exists (select 1 from ${repoRefs} where ${repoRefs.repoId} = ${snapshots.repoId} and ${repoRefs.commitSha} = ${snapshots.commitSha})`,
    options.visibility === undefined ? undefined : eq(repos.visibility, options.visibility),
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
    sql`${rank} < ${EMBED_TIERS.indexOf("other")}`,
  );
}

/**
 * The snapshots served right now that have no complete embedding under the key, of the
 * repositories the worker embeds unasked: the backfill after a change of model, and whatever the
 * queue lost. The highest rank first, and within a rank the newest index first, at most `limit`.
 */
export async function listSnapshotsToEmbed(
  database: Database,
  key: VectorKey,
  limit: number,
  options: SnapshotsToEmbedOptions = {},
): Promise<SnapshotToEmbed[]> {
  const db = drizzleOf(database);
  const rank = rankOf(options.listed ?? []);
  const rows = await db
    .select({
      accountId: snapshots.accountId,
      repoId: snapshots.repoId,
      snapshotId: snapshots.id,
      commitSha: snapshots.commitSha,
      rank,
    })
    .from(snapshots)
    .innerJoin(repos, eq(repos.id, snapshots.repoId))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(toEmbed(db, key, rank, options))
    // Within a rank the newest index first, as the backfill is worth the most where the pack moves.
    .orderBy(rank, sql`${snapshots.indexedAt} desc nulls last`, snapshots.id)
    .limit(limit);
  return rows.map(({ rank: place, ...snapshot }) => ({ ...snapshot, tier: tierAt(place) }));
}

/** How many served snapshots `listSnapshotsToEmbed` would answer without a limit. */
export async function countSnapshotsToEmbed(
  database: Database,
  key: VectorKey,
  options: SnapshotsToEmbedOptions = {},
): Promise<number> {
  const db = drizzleOf(database);
  const rank = rankOf(options.listed ?? []);
  const [row] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(snapshots)
    .innerJoin(repos, eq(repos.id, snapshots.repoId))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(toEmbed(db, key, rank, options));
  return row?.count ?? 0;
}

/**
 * The rank of one snapshot's repository, for whatever queues or runs its embedding: the question
 * the sweep asks of every served snapshot, asked of one. Nothing for a snapshot that is not there.
 */
export async function tierOfSnapshot(
  database: Database,
  scope: SnapshotScope,
  listed: readonly string[],
): Promise<EmbedTier | undefined> {
  const [row] = await drizzleOf(database)
    .select({ rank: rankOf(listed) })
    .from(snapshots)
    .innerJoin(repos, eq(repos.id, snapshots.repoId))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(and(eq(snapshots.id, scope.snapshotId), eq(snapshots.accountId, scope.accountId)))
    .limit(1);
  return row === undefined ? undefined : tierAt(row.rank);
}

/** What was embedded for one repository under a key, over its snapshots. */
export interface EmbeddedRepository {
  readonly host: string;
  /** The account's login, as the host spells it. */
  readonly owner: string;
  readonly name: string;
  readonly visibility: "public" | "private";
  /** Snapshots with an embedding under the key, and how many of them are complete. */
  readonly snapshots: number;
  readonly completed: number;
  readonly bodies: number;
  readonly sections: number;
  readonly bytes: number;
  readonly tokens: number;
  readonly lastEmbeddedAt: Date;
}

/**
 * The repositories with an embedding under the key, the most bytes first, at most `limit`: what
 * the operator reads of where the embedding went. A body shared by two repositories counts for
 * each, since each had it written for its own snapshots.
 */
export async function listEmbeddedRepositories(
  database: Database,
  key: VectorKey,
  limit: number,
): Promise<EmbeddedRepository[]> {
  const rows = await drizzleOf(database)
    .select({
      host: repos.host,
      owner: accounts.login,
      name: repos.name,
      visibility: repos.visibility,
      snapshots: sql<number>`count(*)::integer`,
      completed: sql<number>`count(${snapshotEmbeddings.completedAt})::integer`,
      bodies: sql<string>`coalesce(sum(${snapshotEmbeddings.bodies}), 0)`,
      sections: sql<string>`coalesce(sum(${snapshotEmbeddings.sections}), 0)`,
      bytes: sql<string>`coalesce(sum(${snapshotEmbeddings.bytes}), 0)`,
      tokens: sql<string>`coalesce(sum(${snapshotEmbeddings.tokens}), 0)`,
      lastEmbeddedAt: sql<Date>`max(${snapshotEmbeddings.updatedAt})`,
    })
    .from(snapshotEmbeddings)
    .innerJoin(snapshots, eq(snapshots.id, snapshotEmbeddings.snapshotId))
    .innerJoin(repos, eq(repos.id, snapshots.repoId))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(underKey(key))
    .groupBy(repos.id, repos.host, accounts.login, repos.name, repos.visibility)
    .orderBy(sql`sum(${snapshotEmbeddings.bytes}) desc`, repos.host, accounts.login, repos.name)
    .limit(limit);
  return rows.map((row) => ({
    host: row.host,
    owner: row.owner,
    name: row.name,
    visibility: row.visibility,
    snapshots: row.snapshots,
    completed: row.completed,
    bodies: Number(row.bodies),
    sections: Number(row.sections),
    bytes: Number(row.bytes),
    tokens: Number(row.tokens),
    lastEmbeddedAt: new Date(row.lastEmbeddedAt),
  }));
}

/** What was embedded on one day over every account. */
export interface EmbeddingUsageDay extends EmbeddingUsage {
  readonly day: UsageDay;
}

/** The deployment's embedding per day over every account, from `from` to `to` included, oldest first. */
export async function listEmbeddingUsage(
  database: Database,
  from: UsageDay,
  to: UsageDay,
): Promise<EmbeddingUsageDay[]> {
  const rows = await drizzleOf(database)
    .select({
      day: embeddingUsageDaily.day,
      bytes: sql<string>`sum(${embeddingUsageDaily.bytes})`,
      sections: sql<string>`sum(${embeddingUsageDaily.sections})`,
      tokens: sql<string>`sum(${embeddingUsageDaily.tokens})`,
    })
    .from(embeddingUsageDaily)
    .where(and(gte(embeddingUsageDaily.day, from), lte(embeddingUsageDaily.day, to)))
    .groupBy(embeddingUsageDaily.day)
    .orderBy(embeddingUsageDaily.day);
  return rows.map((row) => ({
    day: row.day,
    bytes: Number(row.bytes),
    sections: Number(row.sections),
    tokens: Number(row.tokens),
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
