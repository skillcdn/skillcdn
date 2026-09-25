import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import {
  blobs,
  indexEntries,
  operatorRepositories,
  repoRefs,
  repos,
  snapshots,
} from "../schema.js";
import type { RepoAlias } from "./repos.js";

// The operator's lists and the takedown (ADR-0026). Neither is tenant data.

export type OperatorListKind = "verified" | "featured" | "blocked";
export const OPERATOR_LIST_KINDS: readonly OperatorListKind[] = ["verified", "featured", "blocked"];

export interface OperatorRepository {
  readonly kind: OperatorListKind;
  /** Canonical, as the operator wrote it: `/gh/owner/repo`, with a ref and a path on a featured entry. */
  readonly address: string;
  readonly createdAt: Date;
}

/** Every entry, or those of one kind, oldest first. */
export async function listOperatorRepositories(
  database: Database,
  kind?: OperatorListKind,
): Promise<OperatorRepository[]> {
  return drizzleOf(database)
    .select({
      kind: operatorRepositories.kind,
      address: operatorRepositories.address,
      createdAt: operatorRepositories.createdAt,
    })
    .from(operatorRepositories)
    .where(kind === undefined ? undefined : eq(operatorRepositories.kind, kind))
    .orderBy(operatorRepositories.createdAt, operatorRepositories.address);
}

/** Idempotent: an entry that is already there stays as it was. */
export async function addOperatorRepository(
  database: Database,
  kind: OperatorListKind,
  address: string,
): Promise<void> {
  await drizzleOf(database)
    .insert(operatorRepositories)
    .values({ kind, address })
    .onConflictDoNothing({ target: [operatorRepositories.kind, operatorRepositories.address] });
}

/** True when the entry was there. */
export async function removeOperatorRepository(
  database: Database,
  kind: OperatorListKind,
  address: string,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(operatorRepositories)
    .where(and(eq(operatorRepositories.kind, kind), eq(operatorRepositories.address, address)))
    .returning({ id: operatorRepositories.id });
  return rows.length > 0;
}

export interface PurgeResult {
  readonly snapshots: number;
  /** Bodies no index entry of any repository references any more, after the snapshots went. */
  readonly blobs: number;
}

/**
 * Removes what was indexed for a repository: its snapshots with their entries, its cached refs,
 * and then every body nothing references any more. The repository row and its aliases stay, so
 * that a blocked repository keeps answering as one that does not exist without being resolved
 * again. `undefined` when the alias names no repository.
 */
export async function purgeRepository(
  database: Database,
  alias: RepoAlias,
): Promise<PurgeResult | undefined> {
  const db = drizzleOf(database);
  const [found] = await db
    .select({ id: repos.id })
    .from(repos)
    .innerJoin(
      sql`repo_aliases`,
      sql`repo_aliases.repo_id = ${repos.id} and repo_aliases.host = ${alias.host} and repo_aliases.owner = ${alias.owner} and repo_aliases.name = ${alias.repo}`,
    )
    .limit(1);
  if (found === undefined) return undefined;
  return db.transaction(async (tx) => {
    // The bodies this repository referred to, noted before its entries go: only those can have
    // become unreferenced, and the table is content-addressed and shared with every other repo.
    const referred = await tx
      .selectDistinct({ sha: indexEntries.blobSha })
      .from(indexEntries)
      .innerJoin(snapshots, eq(indexEntries.snapshotId, snapshots.id))
      .where(eq(snapshots.repoId, found.id));
    const removed = await tx
      .delete(snapshots)
      .where(eq(snapshots.repoId, found.id))
      .returning({ id: snapshots.id });
    await tx.delete(repoRefs).where(eq(repoRefs.repoId, found.id));
    const unreferenced =
      referred.length === 0
        ? []
        : await tx
            .delete(blobs)
            .where(
              and(
                inArray(
                  blobs.sha,
                  referred.map((row) => row.sha),
                ),
                notExists(
                  tx
                    .select({ sha: indexEntries.blobSha })
                    .from(indexEntries)
                    .where(eq(indexEntries.blobSha, blobs.sha)),
                ),
              ),
            )
            .returning({ sha: blobs.sha });
    return { snapshots: removed.length, blobs: unreferenced.length };
  });
}
