import type { RepoFileKind } from "@skillcdn/core";
import { and, eq, lte, or, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import {
  indexEntries,
  type SkillFrontMatter,
  type SnapshotDiagnostic,
  snapshots,
} from "../schema.js";
import type { RepoScope } from "./repos.js";

export type SnapshotStatus = "pending" | "indexing" | "ready" | "failed";

export interface SnapshotRecord {
  readonly id: string;
  readonly accountId: string;
  readonly repoId: string;
  readonly commitSha: string;
  readonly status: SnapshotStatus;
  readonly attempts: number;
  readonly truncated: boolean;
  readonly errorCode: string | null;
  readonly retryAt: Date | null;
}

export interface SnapshotScope {
  readonly accountId: string;
  readonly snapshotId: string;
}

const snapshotColumns = {
  id: snapshots.id,
  accountId: snapshots.accountId,
  repoId: snapshots.repoId,
  commitSha: snapshots.commitSha,
  status: snapshots.status,
  attempts: snapshots.attempts,
  truncated: snapshots.truncated,
  errorCode: snapshots.errorCode,
  retryAt: snapshots.retryAt,
};

function scoped(scope: SnapshotScope) {
  return and(eq(snapshots.id, scope.snapshotId), eq(snapshots.accountId, scope.accountId));
}

/** The snapshot row for a commit, created as `pending` when this is the first time it is seen. */
export async function ensureSnapshot(
  database: Database,
  scope: RepoScope,
  commitSha: string,
): Promise<SnapshotRecord> {
  const db = drizzleOf(database);
  await db
    .insert(snapshots)
    .values({ accountId: scope.accountId, repoId: scope.repoId, commitSha })
    .onConflictDoNothing({ target: [snapshots.repoId, snapshots.commitSha] });
  const [row] = await db
    .select(snapshotColumns)
    .from(snapshots)
    .where(
      and(
        eq(snapshots.repoId, scope.repoId),
        eq(snapshots.commitSha, commitSha),
        eq(snapshots.accountId, scope.accountId),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new Error("snapshot is missing right after it was ensured");
  }
  return row;
}

export async function getSnapshot(
  database: Database,
  scope: SnapshotScope,
): Promise<SnapshotRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(snapshotColumns)
    .from(snapshots)
    .where(scoped(scope))
    .limit(1);
  return row;
}

/**
 * Takes the right to index a snapshot, atomically. Succeeds when nobody has started, when the
 * previous holder's lease ran out, or when a failed attempt is due for a retry. Returns
 * `undefined` when someone else holds it or there is nothing to do.
 */
export async function claimSnapshot(
  database: Database,
  scope: SnapshotScope,
  now: Date,
  leaseMs: number,
): Promise<SnapshotRecord | undefined> {
  const [row] = await drizzleOf(database)
    .update(snapshots)
    .set({
      status: "indexing",
      attempts: sql`${snapshots.attempts} + 1`,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      retryAt: null,
      errorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        scoped(scope),
        or(
          eq(snapshots.status, "pending"),
          and(eq(snapshots.status, "indexing"), lte(snapshots.leaseExpiresAt, now)),
          and(eq(snapshots.status, "failed"), lte(snapshots.retryAt, now)),
        ),
      ),
    )
    .returning(snapshotColumns);
  return row;
}

/** Extends the lease of a snapshot this process is indexing. False when the lease was lost. */
export async function renewSnapshotLease(
  database: Database,
  scope: SnapshotScope,
  now: Date,
  leaseMs: number,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .update(snapshots)
    .set({ leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now })
    .where(and(scoped(scope), eq(snapshots.status, "indexing")))
    .returning({ id: snapshots.id });
  return rows.length > 0;
}

/** Hands an unfinished snapshot back, for example on shutdown, so another process can take it. */
export async function releaseSnapshot(
  database: Database,
  scope: SnapshotScope,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(snapshots)
    .set({ status: "pending", leaseExpiresAt: null, updatedAt: now })
    .where(and(scoped(scope), eq(snapshots.status, "indexing")));
}

export async function failSnapshot(
  database: Database,
  scope: SnapshotScope,
  failure: { readonly errorCode: string; readonly retryAt: Date; readonly now: Date },
): Promise<void> {
  await drizzleOf(database)
    .update(snapshots)
    .set({
      status: "failed",
      errorCode: failure.errorCode,
      retryAt: failure.retryAt,
      leaseExpiresAt: null,
      updatedAt: failure.now,
    })
    .where(and(scoped(scope), eq(snapshots.status, "indexing")));
}

export interface NewIndexEntry {
  readonly path: string;
  readonly kind: RepoFileKind;
  readonly size: number;
  readonly blobSha: string;
  readonly skillDir: string | undefined;
  readonly name: string | undefined;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly frontMatter: SkillFrontMatter | undefined;
  /** Make the entry searchable: metadata always, plus the stored body of `blobSha` if there is one. */
  readonly searchable: boolean;
  /** False for a file a repository manifest leaves out: known, never served. */
  readonly visible: boolean;
}

export interface SnapshotIndex {
  readonly entries: readonly NewIndexEntry[];
  readonly truncated: boolean;
  readonly indexedBytes: number;
  readonly diagnostics: readonly SnapshotDiagnostic[];
}

/** The text-search configuration. Index and query must agree, so it is not configurable. */
export const SEARCH_CONFIG = "english";
/** Characters of a body that go into the search vector: a tsvector is limited to 1 MB. */
const MAX_SEARCHED_BODY_LENGTH = 200_000;
const ENTRY_BATCH_SIZE = 200;

/**
 * Replaces the entries of a snapshot and marks it ready, in one transaction, so readers see
 * either no index or a complete one. Bodies must already be in the blob store. Returns false,
 * and writes nothing, when this process no longer holds the snapshot.
 */
export async function writeSnapshotIndex(
  database: Database,
  scope: SnapshotScope,
  index: SnapshotIndex,
  now: Date,
): Promise<boolean> {
  return drizzleOf(database).transaction(async (tx) => {
    const [held] = await tx
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(scoped(scope), eq(snapshots.status, "indexing")))
      .for("update")
      .limit(1);
    if (held === undefined) {
      return false;
    }
    // A retry starts clean: whatever an interrupted attempt left behind goes first.
    await tx.delete(indexEntries).where(eq(indexEntries.snapshotId, scope.snapshotId));

    for (let start = 0; start < index.entries.length; start += ENTRY_BATCH_SIZE) {
      const batch = index.entries.slice(start, start + ENTRY_BATCH_SIZE);
      const rows = sql.join(
        batch.map(
          (entry) =>
            sql`(${entry.path}, ${entry.kind}, ${entry.size}::integer, ${entry.blobSha}, ${entry.skillDir ?? null}, ${entry.name ?? null}, ${entry.title ?? null}, ${entry.description ?? null}, ${entry.frontMatter === undefined ? null : JSON.stringify(entry.frontMatter)}::jsonb, ${entry.searchable}::boolean, ${entry.visible}::boolean)`,
        ),
        sql`, `,
      );
      // Name and title weigh most, then the description, then the path, then the body.
      await tx.execute(sql`
        insert into index_entries
          (account_id, snapshot_id, path, kind, size, blob_sha, skill_dir, name, title, description, front_matter, search, visible)
        select
          ${scope.accountId}::uuid, ${scope.snapshotId}::uuid,
          v.path, v.kind, v.size, v.blob_sha, v.skill_dir, v.name, v.title, v.description, v.front_matter,
          case when v.searchable then
            setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, coalesce(v.name, '') || ' ' || coalesce(v.title, '')), 'A') ||
            setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, coalesce(v.description, '')), 'B') ||
            setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, translate(v.path, '/._-', '    ')), 'C') ||
            setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, coalesce(left(b.content, ${MAX_SEARCHED_BODY_LENGTH}::integer), '')), 'D')
          end,
          v.visible
        from (values ${rows})
          as v (path, kind, size, blob_sha, skill_dir, name, title, description, front_matter, searchable, visible)
        left join blobs b on b.sha = v.blob_sha and v.searchable
      `);
    }

    await tx
      .update(snapshots)
      .set({
        status: "ready",
        truncated: index.truncated,
        fileCount: index.entries.length,
        indexedFileCount: index.entries.filter((entry) => entry.searchable).length,
        indexedBytes: index.indexedBytes,
        diagnostics: [...index.diagnostics],
        leaseExpiresAt: null,
        indexedAt: now,
        updatedAt: now,
      })
      .where(scoped(scope));
    return true;
  });
}

export async function getSnapshotDiagnostics(
  database: Database,
  scope: SnapshotScope,
): Promise<readonly SnapshotDiagnostic[]> {
  const [row] = await drizzleOf(database)
    .select({ diagnostics: snapshots.diagnostics })
    .from(snapshots)
    .where(scoped(scope))
    .limit(1);
  return row?.diagnostics ?? [];
}
