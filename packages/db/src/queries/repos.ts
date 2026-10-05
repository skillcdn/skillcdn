import type { GitHostKey, HostRepository } from "@skillcdn/core";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, missingRepos, repoAliases, repoRefs, repos } from "../schema.js";

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

/**
 * Records that the host stopped showing a repository to everyone: it is gone or it is private,
 * which a look without the right to see it cannot tell apart. Either way nothing may list it as
 * public any longer. A later look by someone who can see it writes down what it really is.
 */
export async function markRepositoryNotPublic(
  database: Database,
  scope: RepoScope,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(repos)
    .set({ visibility: "private", updatedAt: now })
    .where(
      and(
        eq(repos.accountId, scope.accountId),
        eq(repos.id, scope.repoId),
        eq(repos.visibility, "public"),
      ),
    );
}

/** A repository as an event of the git host names it: by the host's immutable id. */
export interface HostRepoKey {
  readonly host: GitHostKey;
  readonly hostRepoId: string;
}

export interface KnownRepo extends RepoScope {
  /** What the host last reported. */
  readonly visibility: "public" | "private";
}

/** The repository the host knows by this id, when it was ever seen here. */
export async function findRepoByHostId(
  database: Database,
  key: HostRepoKey,
): Promise<KnownRepo | undefined> {
  const [row] = await drizzleOf(database)
    .select({ repoId: repos.id, accountId: repos.accountId, visibility: repos.visibility })
    .from(repos)
    .where(and(eq(repos.host, key.host), eq(repos.hostRepoId, key.hostRepoId)))
    .limit(1);
  return row;
}

/** The repositories of the account the host knows by this id, as far as they were seen here. */
export async function listReposOfHostAccount(
  database: Database,
  key: { readonly host: GitHostKey; readonly hostAccountId: string },
): Promise<KnownRepo[]> {
  return drizzleOf(database)
    .select({ repoId: repos.id, accountId: repos.accountId, visibility: repos.visibility })
    .from(repos)
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(and(eq(accounts.host, key.host), eq(accounts.hostAccountId, key.hostAccountId)));
}

/**
 * Ends what is believed about a repository's refs: every ref confirmed after `staleAt` counts
 * as confirmed then, so the next request asks the host where it points. Nothing is deleted: a
 * caller that tolerates an old answer while the host cannot be asked still has one.
 */
export async function expireRepoRefs(
  database: Database,
  scope: RepoScope,
  staleAt: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(repoRefs)
    .set({ checkedAt: staleAt })
    .where(
      and(
        eq(repoRefs.accountId, scope.accountId),
        eq(repoRefs.repoId, scope.repoId),
        gt(repoRefs.checkedAt, staleAt),
      ),
    );
}

/**
 * Ends what is believed about a repository's names: every alias confirmed after `staleAt`
 * counts as confirmed then, so the next request asks the host what the name means now.
 */
export async function expireRepoAliases(
  database: Database,
  scope: RepoScope,
  staleAt: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(repoAliases)
    .set({ checkedAt: staleAt })
    .where(and(eq(repoAliases.repoId, scope.repoId), gt(repoAliases.checkedAt, staleAt)));
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

/**
 * When a request from nobody in particular last found the name to be nothing to the public, if
 * one did and the note is still kept. How long that is believed is the caller's rule.
 */
export async function findMissingRepo(
  database: Database,
  alias: RepoAlias,
): Promise<Date | undefined> {
  const [row] = await drizzleOf(database)
    .select({ checkedAt: missingRepos.checkedAt })
    .from(missingRepos)
    .where(
      and(
        eq(missingRepos.host, alias.host),
        eq(missingRepos.owner, alias.owner),
        eq(missingRepos.name, alias.repo),
      ),
    )
    .limit(1);
  return row?.checkedAt;
}

/**
 * Notes that the host just showed the public nothing under the name. Only a request from nobody
 * in particular may cause it: what a person's question finds out is theirs alone.
 */
export async function saveMissingRepo(
  database: Database,
  alias: RepoAlias,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .insert(missingRepos)
    .values({ host: alias.host, owner: alias.owner, name: alias.repo, checkedAt: now })
    .onConflictDoUpdate({
      target: [missingRepos.host, missingRepos.owner, missingRepos.name],
      set: { checkedAt: now },
    });
}

/** Removes the notes made before `before`, which nothing believes any more. */
export async function deleteStaleMissingRepos(database: Database, before: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(missingRepos)
    .where(lt(missingRepos.checkedAt, before))
    .returning({ id: missingRepos.id });
  return rows.length;
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
