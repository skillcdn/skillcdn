import { and, count, eq, gt, lte, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, repoTokens, users } from "../schema.js";
import { toUser, type UserRecord, userColumns } from "./users.js";

// Tokens a user made for one repository each, for agents with nobody to sign in
// (docs/specs/permissions.md). Identity data like a grant: every query names the user, or the
// hash of the secret that names the row. A token says who made it and where it is good, never
// what that person may see: the caller asks the git host, as for any request of theirs.

export interface RepoTokenRecord {
  readonly id: string;
  /** The repository the token is good at. */
  readonly repoId: string;
  /** The address the token was made for: canonical, a repository without a ref or a path. */
  readonly address: string;
  /** What its maker calls it. */
  readonly label: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** When it was last noted as used; `undefined` when never. */
  readonly lastUsedAt: Date | undefined;
}

export interface RepoTokenInput {
  readonly userId: string;
  readonly repoId: string;
  readonly address: string;
  readonly label: string;
  /** The hash of the secret; the secret itself never reaches this package. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

const recordColumns = {
  id: repoTokens.id,
  repoId: repoTokens.repoId,
  address: repoTokens.address,
  label: repoTokens.label,
  createdAt: repoTokens.createdAt,
  expiresAt: repoTokens.expiresAt,
  lastUsedAt: repoTokens.lastUsedAt,
};

type RecordRow = Omit<RepoTokenRecord, "lastUsedAt"> & { readonly lastUsedAt: Date | null };

const toRecord = (row: RecordRow): RepoTokenRecord => ({
  ...row,
  lastUsedAt: row.lastUsedAt ?? undefined,
});

/**
 * Stores a token for its user. What a person can make is bounded: with `limit` tokens of theirs
 * that have not expired, nothing is stored and the answer is `undefined`. Nothing is ended to
 * make room, since an agent somewhere is using each of them.
 */
export async function createRepoToken(
  database: Database,
  input: RepoTokenInput,
  limit: number,
): Promise<RepoTokenRecord | undefined> {
  return drizzleOf(database).transaction(async (tx) => {
    const [held] = await tx
      .select({ count: count() })
      .from(repoTokens)
      .where(and(eq(repoTokens.userId, input.userId), gt(repoTokens.expiresAt, input.now)));
    if ((held?.count ?? 0) >= limit) {
      return undefined;
    }
    const [row] = await tx
      .insert(repoTokens)
      .values({
        userId: input.userId,
        repoId: input.repoId,
        address: input.address,
        label: input.label,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      })
      .returning(recordColumns);
    if (row === undefined) {
      throw new Error("token insert returned no row");
    }
    return toRecord(row);
  });
}

/** The tokens of a user that have not expired, newest first. */
export async function listRepoTokens(
  database: Database,
  userId: string,
  now: Date,
): Promise<RepoTokenRecord[]> {
  const rows = await drizzleOf(database)
    .select(recordColumns)
    .from(repoTokens)
    .where(and(eq(repoTokens.userId, userId), gt(repoTokens.expiresAt, now)))
    .orderBy(sql`${repoTokens.createdAt} desc`, sql`${repoTokens.id} desc`);
  return rows.map(toRecord);
}

/** Takes a token back. True when it was this user's. */
export async function deleteRepoToken(
  database: Database,
  token: { readonly userId: string; readonly tokenId: string },
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(repoTokens)
    .where(and(eq(repoTokens.id, token.tokenId), eq(repoTokens.userId, token.userId)))
    .returning({ id: repoTokens.id });
  return rows.length > 0;
}

export interface RepoTokenAccess {
  readonly tokenId: string;
  /** Who made the token: every request made with it is theirs. */
  readonly user: UserRecord;
  readonly repoId: string;
  /** The address the token was made for. */
  readonly address: string;
  readonly lastUsedAt: Date | undefined;
}

/** What a token stands for, while it has not expired. */
export async function findRepoTokenAccess(
  database: Database,
  tokenHash: string,
  now: Date,
): Promise<RepoTokenAccess | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      tokenId: repoTokens.id,
      repoId: repoTokens.repoId,
      address: repoTokens.address,
      lastUsedAt: repoTokens.lastUsedAt,
      ...userColumns,
    })
    .from(repoTokens)
    .innerJoin(users, eq(users.id, repoTokens.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(and(eq(repoTokens.tokenHash, tokenHash), gt(repoTokens.expiresAt, now)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        tokenId: row.tokenId,
        user: toUser(row),
        repoId: row.repoId,
        address: row.address,
        lastUsedAt: row.lastUsedAt ?? undefined,
      };
}

/** Notes that a token was used. */
export async function touchRepoToken(
  database: Database,
  tokenId: string,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(repoTokens)
    .set({ lastUsedAt: now })
    .where(eq(repoTokens.id, tokenId));
}

export async function deleteExpiredRepoTokens(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(repoTokens)
    .where(lte(repoTokens.expiresAt, now))
    .returning({ id: repoTokens.id });
  return rows.length;
}
