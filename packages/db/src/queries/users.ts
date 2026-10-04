import type { GitHostKey, HostUser } from "@skillcdn/core";
import { and, eq, gt, lte } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import {
  accounts,
  oauthCodes,
  oauthGrants,
  repoPermissions,
  sessions,
  userCredentials,
  users,
} from "../schema.js";

// People who signed in, what the git host issued them, and the browsers they are signed in on
// (docs/specs/permissions.md). Identity data: every query names the user, or the hash of the
// secret that names the row.

export interface UserRecord {
  readonly id: string;
  /** The account of the git host this person is. */
  readonly accountId: string;
  readonly host: GitHostKey;
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | undefined;
}

/** What the git host issued a user, as it is stored: the tokens are ciphertext. */
export interface StoredCredentials {
  readonly accessToken: string;
  readonly accessExpiresAt: Date | undefined;
  readonly refreshToken: string | undefined;
  readonly refreshExpiresAt: Date | undefined;
}

/** For this package only: the columns a {@link UserRecord} is made of, joined from both tables. */
export const userColumns = {
  id: users.id,
  accountId: users.accountId,
  host: accounts.host,
  hostAccountId: accounts.hostAccountId,
  login: accounts.login,
  name: users.name,
};

export type UserRow = {
  readonly id: string;
  readonly accountId: string;
  readonly host: string;
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | null;
};

export const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  accountId: row.accountId,
  // The only host there is; a second one arrives with its adapter and its key.
  host: row.host as GitHostKey,
  hostAccountId: row.hostAccountId,
  login: row.login,
  name: row.name ?? undefined,
});

/**
 * Records that a person signed in: the account is keyed by the host's immutable id, so a
 * renamed account stays the same user, and the login and the name are what the host says now.
 */
export async function saveLogin(
  database: Database,
  login: { readonly host: GitHostKey; readonly user: HostUser; readonly now: Date },
): Promise<UserRecord> {
  const { host, user, now } = login;
  return drizzleOf(database).transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        host,
        hostAccountId: user.hostAccountId,
        login: user.login,
        kind: "user",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [accounts.host, accounts.hostAccountId],
        set: { login: user.login, kind: "user", updatedAt: now },
      })
      .returning({ id: accounts.id });
    if (account === undefined) {
      throw new Error("account upsert returned no row");
    }
    const [row] = await tx
      .insert(users)
      .values({ accountId: account.id, name: user.name ?? null, lastLoginAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [users.accountId],
        set: { name: user.name ?? null, lastLoginAt: now, updatedAt: now },
      })
      .returning({ id: users.id });
    if (row === undefined) {
      throw new Error("user upsert returned no row");
    }
    return {
      id: row.id,
      accountId: account.id,
      host,
      hostAccountId: user.hostAccountId,
      login: user.login,
      name: user.name,
    };
  });
}

export async function findUser(
  database: Database,
  userId: string,
): Promise<UserRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(userColumns)
    .from(users)
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(eq(users.id, userId))
    .limit(1);
  return row === undefined ? undefined : toUser(row);
}

/** What the git host issued the user, or `undefined` when nothing usable is stored. */
export async function getUserCredentials(
  database: Database,
  userId: string,
): Promise<StoredCredentials | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      accessToken: userCredentials.accessToken,
      accessExpiresAt: userCredentials.accessExpiresAt,
      refreshToken: userCredentials.refreshToken,
      refreshExpiresAt: userCredentials.refreshExpiresAt,
    })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        accessToken: row.accessToken,
        accessExpiresAt: row.accessExpiresAt ?? undefined,
        refreshToken: row.refreshToken ?? undefined,
        refreshExpiresAt: row.refreshExpiresAt ?? undefined,
      };
}

/** Replaces what is stored for the user. The caller encrypted the tokens. */
export async function saveUserCredentials(
  database: Database,
  userId: string,
  credentials: StoredCredentials,
  now: Date,
): Promise<void> {
  const values = {
    accessToken: credentials.accessToken,
    accessExpiresAt: credentials.accessExpiresAt ?? null,
    refreshToken: credentials.refreshToken ?? null,
    refreshExpiresAt: credentials.refreshExpiresAt ?? null,
    updatedAt: now,
  };
  await drizzleOf(database)
    .insert(userCredentials)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: [userCredentials.userId], set: values });
}

/**
 * Forgets what the git host issued the user, when the host no longer accepts it. `unless`
 * names the access token that was found unusable: a row that holds another one by now was
 * renewed by someone else and stays. True when a row went.
 */
export async function deleteUserCredentials(
  database: Database,
  userId: string,
  unless?: { readonly accessToken: string },
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(userCredentials)
    .where(
      and(
        eq(userCredentials.userId, userId),
        unless === undefined ? undefined : eq(userCredentials.accessToken, unless.accessToken),
      ),
    )
    .returning({ id: userCredentials.id });
  return rows.length > 0;
}

export interface SessionRecord {
  readonly id: string;
  readonly user: UserRecord;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
}

export async function createSession(
  database: Database,
  session: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database).insert(sessions).values({
    userId: session.userId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    lastSeenAt: session.now,
  });
}

/** The session a token names, with its user, while it has not expired. */
export async function findSession(
  database: Database,
  tokenHash: string,
  now: Date,
): Promise<SessionRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      ...userColumns,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        id: row.sessionId,
        user: toUser(row),
        expiresAt: row.expiresAt,
        lastSeenAt: row.lastSeenAt,
      };
}

/** Notes that a session was used, and moves its end when the caller keeps it alive by use. */
export async function touchSession(
  database: Database,
  sessionId: string,
  seen: { readonly now: Date; readonly expiresAt: Date },
): Promise<void> {
  await drizzleOf(database)
    .update(sessions)
    .set({ lastSeenAt: seen.now, expiresAt: seen.expiresAt })
    .where(eq(sessions.id, sessionId));
}

/** True when the session was there. */
export async function deleteSession(database: Database, tokenHash: string): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/**
 * Signs a user out of everything: their sessions, what they allowed clients, and what was
 * remembered about what they can see. What losing the git host's credential means, since all of
 * it stood on that credential. The user stays, and so does whatever the host issues them next.
 */
export async function forgetUserAccess(database: Database, userId: string): Promise<void> {
  await drizzleOf(database).transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(oauthCodes).where(eq(oauthCodes.userId, userId));
    // Tokens go with their grants.
    await tx.delete(oauthGrants).where(eq(oauthGrants.userId, userId));
    await tx.delete(repoPermissions).where(eq(repoPermissions.userId, userId));
  });
}

export async function deleteExpiredSessions(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return rows.length;
}
