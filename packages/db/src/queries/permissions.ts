import { and, eq, lt } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, repoAliases, repoPermissions, repos } from "../schema.js";
import type { RepoAlias, RepoAliasRecord } from "./repos.js";

// The permission cache (docs/specs/permissions.md): what the git host last answered when asked
// whether a user can see a repository. The host owns permissions; a row only saves asking again
// for a short while, and how long is the caller's to say.

export interface RepoPermissionScope {
  readonly userId: string;
  readonly repoId: string;
}

export interface RepoPermission {
  readonly allowed: boolean;
  /** When the host gave this answer. */
  readonly checkedAt: Date;
}

export async function findRepoPermission(
  database: Database,
  scope: RepoPermissionScope,
): Promise<RepoPermission | undefined> {
  const [row] = await drizzleOf(database)
    .select({ allowed: repoPermissions.allowed, checkedAt: repoPermissions.checkedAt })
    .from(repoPermissions)
    .where(and(eq(repoPermissions.userId, scope.userId), eq(repoPermissions.repoId, scope.repoId)))
    .limit(1);
  return row;
}

export interface ReadableRepo {
  /** The repository the name means, as last recorded, with when the name was last confirmed. */
  readonly repo: RepoAliasRecord;
  /** When the host last said the user can see it. */
  readonly checkedAt: Date;
}

/**
 * The repository a name leads to, when the host's last answer was that this user can see it.
 * One query from the user's side: it finds nothing for a name that is nothing and for a
 * repository the user was never let see alike, so asking it tells the two apart for nobody.
 */
export async function findReadableRepo(
  database: Database,
  scope: { readonly userId: string; readonly alias: RepoAlias },
): Promise<ReadableRepo | undefined> {
  const { userId, alias } = scope;
  const [row] = await drizzleOf(database)
    .select({
      alias: repoAliases,
      repo: repos,
      account: accounts,
      checkedAt: repoPermissions.checkedAt,
    })
    .from(repoPermissions)
    .innerJoin(repos, eq(repos.id, repoPermissions.repoId))
    .innerJoin(repoAliases, eq(repoAliases.repoId, repos.id))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(
      and(
        eq(repoPermissions.userId, userId),
        eq(repoPermissions.allowed, true),
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
    checkedAt: row.checkedAt,
    repo: {
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
    },
  };
}

export async function saveRepoPermission(
  database: Database,
  scope: RepoPermissionScope,
  allowed: boolean,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .insert(repoPermissions)
    .values({ userId: scope.userId, repoId: scope.repoId, allowed, checkedAt: now })
    .onConflictDoUpdate({
      target: [repoPermissions.userId, repoPermissions.repoId],
      set: { allowed, checkedAt: now },
    });
}

/** Removes the answers given before `before`, which nothing trusts any more. */
export async function deleteStaleRepoPermissions(
  database: Database,
  before: Date,
): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(repoPermissions)
    .where(lt(repoPermissions.checkedAt, before))
    .returning({ id: repoPermissions.id });
  return rows.length;
}
