import type { LicenseFact, SnapshotDiagnostic, SnapshotIndex } from "@skillcdn/core";
import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { indexEntries, snapshotEmbeddings, snapshots } from "../schema.js";
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
  /** The reading rules the index was written with; 0 until it is. See `ensureSnapshot`. */
  readonly indexVersion: number;
  /** The license that governs the repository outside its skills (ADR-0026); null until indexed. */
  readonly license: LicenseFact | null;
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
  license: snapshots.license,
  errorCode: snapshots.errorCode,
  retryAt: snapshots.retryAt,
  indexVersion: snapshots.indexVersion,
};

function scoped(scope: SnapshotScope) {
  return and(eq(snapshots.id, scope.snapshotId), eq(snapshots.accountId, scope.accountId));
}

/**
 * The snapshot row for a commit, created as `pending` when this is the first time it is seen.
 *
 * What a commit serves is decided when it is indexed, so a change to the reading rules has to
 * reach the commits indexed before it: a ready index written under a version below
 * `indexVersion` goes back to `pending` here, for whoever asks next to claim and rebuild. Only a
 * ready index is rebuilt: a failed one retries on its own schedule, and one being indexed is
 * written by whoever holds it, with its version. Newer rules are never undone by older ones.
 */
export async function ensureSnapshot(
  database: Database,
  scope: RepoScope,
  commitSha: string,
  indexVersion: number,
  now: Date,
): Promise<SnapshotRecord> {
  const db = drizzleOf(database);
  const ofCommit = and(
    eq(snapshots.repoId, scope.repoId),
    eq(snapshots.commitSha, commitSha),
    eq(snapshots.accountId, scope.accountId),
  );
  const current = async (): Promise<SnapshotRecord> => {
    const [row] = await db.select(snapshotColumns).from(snapshots).where(ofCommit).limit(1);
    if (row === undefined) {
      throw new Error("snapshot is missing right after it was ensured");
    }
    return row;
  };
  await db
    .insert(snapshots)
    .values({ accountId: scope.accountId, repoId: scope.repoId, commitSha })
    .onConflictDoNothing({ target: [snapshots.repoId, snapshots.commitSha] });
  const row = await current();
  if (row.status !== "ready" || row.indexVersion >= indexVersion) {
    return row;
  }
  const [rebuilt] = await db
    .update(snapshots)
    .set({
      status: "pending",
      leaseExpiresAt: null,
      retryAt: null,
      errorCode: null,
      updatedAt: now,
    })
    .where(and(ofCommit, eq(snapshots.status, "ready"), lt(snapshots.indexVersion, indexVersion)))
    .returning(snapshotColumns);
  // Somebody else sent it back first, or claimed it already: whatever it is now.
  return rebuilt ?? current();
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
 * The snapshot of a commit, whatever its state, without making one: `undefined` when the commit
 * was never asked for. What answers for a ref while its newest commit's index is not ready is
 * found this way (ADR-0068).
 */
export async function findSnapshotOfCommit(
  database: Database,
  scope: RepoScope,
  commitSha: string,
): Promise<SnapshotRecord | undefined> {
  const [row] = await drizzleOf(database)
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
  return row;
}

/**
 * Takes the right to index a snapshot, atomically. Succeeds when nobody has started, when the
 * previous holder's lease ran out, or when a failed attempt is due for a retry. Returns
 * `undefined` when someone else holds it or there is nothing to do.
 *
 * `owner` names the claim: renewing, writing, failing and releasing take the same token, so a
 * holder whose lease ran out while it was paused cannot undo what its successor did.
 */
export async function claimSnapshot(
  database: Database,
  scope: SnapshotScope,
  owner: string,
  now: Date,
  leaseMs: number,
): Promise<SnapshotRecord | undefined> {
  const [row] = await drizzleOf(database)
    .update(snapshots)
    .set({
      status: "indexing",
      attempts: sql`${snapshots.attempts} + 1`,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      leaseOwner: owner,
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

/** The snapshot while the claim named `owner` holds it. */
function heldBy(scope: SnapshotScope, owner: string) {
  return and(scoped(scope), eq(snapshots.status, "indexing"), eq(snapshots.leaseOwner, owner));
}

/** Extends the lease of a snapshot this claim is indexing. False when the lease was lost. */
export async function renewSnapshotLease(
  database: Database,
  scope: SnapshotScope,
  owner: string,
  now: Date,
  leaseMs: number,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .update(snapshots)
    .set({ leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now })
    .where(heldBy(scope, owner))
    .returning({ id: snapshots.id });
  return rows.length > 0;
}

/** Hands an unfinished snapshot back, for example on shutdown, so another process can take it. */
export async function releaseSnapshot(
  database: Database,
  scope: SnapshotScope,
  owner: string,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(snapshots)
    .set({ status: "pending", leaseExpiresAt: null, leaseOwner: null, updatedAt: now })
    .where(heldBy(scope, owner));
}

export async function failSnapshot(
  database: Database,
  scope: SnapshotScope,
  owner: string,
  failure: { readonly errorCode: string; readonly retryAt: Date; readonly now: Date },
): Promise<void> {
  await drizzleOf(database)
    .update(snapshots)
    .set({
      status: "failed",
      errorCode: failure.errorCode,
      retryAt: failure.retryAt,
      leaseExpiresAt: null,
      leaseOwner: null,
      updatedAt: failure.now,
    })
    .where(heldBy(scope, owner));
}

const ENTRY_BATCH_SIZE = 200;

/**
 * Replaces the entries of a snapshot and marks it ready, in one transaction, so readers see
 * either no index or a complete one. Bodies must already be in the blob store. Returns false,
 * and writes nothing, when the claim named `owner` no longer holds the snapshot.
 */
export async function writeSnapshotIndex(
  database: Database,
  scope: SnapshotScope,
  owner: string,
  index: SnapshotIndex,
  now: Date,
): Promise<boolean> {
  return drizzleOf(database).transaction(async (tx) => {
    const [held] = await tx
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(heldBy(scope, owner))
      .for("update")
      .limit(1);
    if (held === undefined) {
      return false;
    }
    // A retry starts clean: whatever an interrupted attempt left behind goes first. A new index
    // may name other bodies, so what was embedded of the old one no longer says the snapshot is
    // done; the vectors themselves stay with their bodies (ADR-0064).
    await tx.delete(indexEntries).where(eq(indexEntries.snapshotId, scope.snapshotId));
    await tx.delete(snapshotEmbeddings).where(eq(snapshotEmbeddings.snapshotId, scope.snapshotId));

    for (let start = 0; start < index.entries.length; start += ENTRY_BATCH_SIZE) {
      const batch = index.entries.slice(start, start + ENTRY_BATCH_SIZE);
      // The search vector arrives built, in the text form of a tsvector (ADR-0063): the indexer
      // read the words with the pack's language, and the same vector is kept in memory by the
      // command. A searchable entry without one is an empty vector, so that it stays findable
      // by listing; an entry that is not searched has none.
      const rows = sql.join(
        batch.map(
          (entry) =>
            sql`(${entry.path}, ${entry.kind}, ${entry.size}::integer, ${entry.blobSha}, ${entry.skillDir ?? null}, ${entry.name ?? null}, ${entry.title ?? null}, ${entry.description ?? null}, ${entry.frontMatter === undefined ? null : JSON.stringify(entry.frontMatter)}::jsonb, ${entry.searchable ? (entry.search ?? "") : null}::tsvector, ${entry.visible}::boolean, ${entry.digest ?? null}::text, ${entry.servedSize ?? null}::integer, ${entry.listed ?? false}::boolean, ${entry.licenseKind ?? null}::text)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        insert into index_entries
          (account_id, snapshot_id, path, kind, size, blob_sha, skill_dir, name, title, description, front_matter, search, visible, digest, served_size, listed, license_kind)
        select
          ${scope.accountId}::uuid, ${scope.snapshotId}::uuid,
          v.path, v.kind, v.size, v.blob_sha, v.skill_dir, v.name, v.title, v.description, v.front_matter,
          v.search, v.visible, v.digest, v.served_size, v.listed, v.license_kind
        from (values ${rows})
          as v (path, kind, size, blob_sha, skill_dir, name, title, description, front_matter, search, visible, digest, served_size, listed, license_kind)
      `);
    }

    await tx
      .update(snapshots)
      .set({
        status: "ready",
        indexVersion: index.version,
        truncated: index.truncated,
        fileCount: index.entries.length,
        indexedFileCount: index.entries.filter((entry) => entry.searchable).length,
        indexedBytes: index.indexedBytes,
        diagnostics: [...index.diagnostics],
        license: index.license,
        leaseExpiresAt: null,
        leaseOwner: null,
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
