import type { GitHostKey, HostRepository } from "@skillcdn/core";
import { and, eq, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, repoAliases, repoRefs, repos } from "../schema.js";

export interface RepoRecord {
  readonly id: string;
  readonly accountId: string;
  readonly host: GitHostKey;
  /** What the host reported; this is what gets handed back to domain code. */
  readonly repository: HostRepository;
}

export interface RepoAliasRecord extends RepoRecord {
  /** When the host last confirmed that this name means this repository. */
  readonly checkedAt: Date;
}

export interface RepoAlias {
  readonly host: GitHostKey;
  /** Lowercase, as the address parser produces them. */
  readonly owner: string;
  readonly repo: string;
}

/** Tenant-scoped arguments: every query on tenant data names the account. */
export interface RepoScope {
  readonly accountId: string;
  readonly repoId: string;
}

/** The repository an `owner/name` spelling was last seen to mean, however long ago that was. */
export async function findRepoByAlias(
  database: Database,
  alias: RepoAlias,
): Promise<RepoAliasRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select({ alias: repoAliases, repo: repos, account: accounts })
    .from(repoAliases)
    .innerJoin(repos, eq(repos.id, repoAliases.repoId))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(
      and(
        eq(repoAliases.host, alias.host),
        eq(repoAliases.owner, alias.owner),
        eq(repoAliases.name, alias.repo),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.repo.id,
    accountId: row.repo.accountId,
    host: alias.host,
    checkedAt: row.alias.checkedAt,
    repository: {
      hostRepoId: row.repo.hostRepoId,
      name: row.repo.name,
      defaultBranch: row.repo.defaultBranch,
      description: row.repo.description ?? undefined,
      visibility: row.repo.visibility,
      owner: {
        hostAccountId: row.account.hostAccountId,
        login: row.account.login,
        kind: row.account.kind,
      },
    },
  };
}

/**
 * Records what the host just said about `alias`: the account and the repository are keyed by the
 * host's immutable ids, and the alias is pointed at that repository, wherever it pointed before.
 */
export async function saveRepository(
  database: Database,
  alias: RepoAlias,
  repository: HostRepository,
  now: Date,
): Promise<RepoRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        host: alias.host,
        hostAccountId: repository.owner.hostAccountId,
        login: repository.owner.login,
        kind: repository.owner.kind,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [accounts.host, accounts.hostAccountId],
        set: { login: repository.owner.login, kind: repository.owner.kind, updatedAt: now },
      })
      .returning({ id: accounts.id });
    if (account === undefined) {
      throw new Error("account upsert returned no row");
    }

    const [repo] = await tx
      .insert(repos)
      .values({
        accountId: account.id,
        host: alias.host,
        hostRepoId: repository.hostRepoId,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        description: repository.description ?? null,
        visibility: repository.visibility,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [repos.host, repos.hostRepoId],
        set: {
          // A transfer moves the repository to another account; its index moves with it.
          accountId: account.id,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          description: repository.description ?? null,
          visibility: repository.visibility,
          updatedAt: now,
        },
      })
      .returning({ id: repos.id });
    if (repo === undefined) {
      throw new Error("repository upsert returned no row");
    }

    await tx
      .insert(repoAliases)
      .values({
        host: alias.host,
        owner: alias.owner,
        name: alias.repo,
        repoId: repo.id,
        checkedAt: now,
      })
      .onConflictDoUpdate({
        target: [repoAliases.host, repoAliases.owner, repoAliases.name],
        set: { repoId: repo.id, checkedAt: now },
      });

    return { id: repo.id, accountId: account.id, host: alias.host, repository };
  });
}

/** Forgets an alias, for example when the host says the name no longer exists. */
export async function deleteRepoAlias(database: Database, alias: RepoAlias): Promise<void> {
  await drizzleOf(database)
    .delete(repoAliases)
    .where(
      and(
        eq(repoAliases.host, alias.host),
        eq(repoAliases.owner, alias.owner),
        eq(repoAliases.name, alias.repo),
      ),
    );
}

export interface CachedRef {
  readonly commitSha: string;
  readonly checkedAt: Date;
}

/** The commit a moving ref was last seen at. The empty ref is the default branch. */
export async function findCachedRef(
  database: Database,
  scope: RepoScope,
  ref: string,
): Promise<CachedRef | undefined> {
  const [row] = await drizzleOf(database)
    .select({ commitSha: repoRefs.commitSha, checkedAt: repoRefs.checkedAt })
    .from(repoRefs)
    .where(
      and(
        eq(repoRefs.accountId, scope.accountId),
        eq(repoRefs.repoId, scope.repoId),
        eq(repoRefs.ref, ref),
      ),
    )
    .limit(1);
  return row;
}

export async function saveCachedRef(
  database: Database,
  scope: RepoScope,
  ref: string,
  commitSha: string,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .insert(repoRefs)
    .values({ accountId: scope.accountId, repoId: scope.repoId, ref, commitSha, checkedAt: now })
    .onConflictDoUpdate({
      target: [repoRefs.repoId, repoRefs.ref],
      set: { commitSha, checkedAt: now, accountId: sql`excluded.account_id` },
    });
}
