import { and, eq, gt, lt, lte, notExists, notInArray, or, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, oauthClients, oauthCodes, oauthGrants, oauthTokens, users } from "../schema.js";
import { toUser, type UserRecord, userColumns } from "./users.js";

// The authorization server's state (docs/specs/permissions.md): the clients that ask, the codes
// on their way to the token endpoint, what users allowed, and the tokens issued for it. Secrets
// arrive here as hashes; nothing in these tables can be presented as a credential.

export type OAuthClientSource = "registration" | "document";
export type OAuthClientAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

export interface OAuthClientInput {
  /** What the client is called in requests: issued at registration, or the document's URL. */
  readonly clientId: string;
  readonly source: OAuthClientSource;
  readonly name: string;
  readonly uri: string | undefined;
  readonly redirectUris: readonly string[];
  readonly authMethod: OAuthClientAuthMethod;
  readonly secretHash: string | undefined;
  /** For a document: until when the copy stands before it is fetched again. */
  readonly freshUntil: Date | undefined;
}

export interface OAuthClientRecord extends OAuthClientInput {
  /** The row's own id, which codes and grants refer to. */
  readonly id: string;
}

const clientColumns = {
  id: oauthClients.id,
  clientId: oauthClients.clientId,
  source: oauthClients.source,
  name: oauthClients.name,
  uri: oauthClients.uri,
  redirectUris: oauthClients.redirectUris,
  authMethod: oauthClients.authMethod,
  secretHash: oauthClients.secretHash,
  freshUntil: oauthClients.freshUntil,
};

const toClient = (row: {
  readonly id: string;
  readonly clientId: string;
  readonly source: OAuthClientSource;
  readonly name: string;
  readonly uri: string | null;
  readonly redirectUris: string[];
  readonly authMethod: OAuthClientAuthMethod;
  readonly secretHash: string | null;
  readonly freshUntil: Date | null;
}): OAuthClientRecord => ({
  id: row.id,
  clientId: row.clientId,
  source: row.source,
  name: row.name,
  uri: row.uri ?? undefined,
  redirectUris: row.redirectUris,
  authMethod: row.authMethod,
  secretHash: row.secretHash ?? undefined,
  freshUntil: row.freshUntil ?? undefined,
});

/**
 * Stores a client under its identifier, replacing what was stored: a registration is written
 * once, a document again whenever it is fetched. The row keeps its id, so grants made before a
 * document changed still name the client.
 */
export async function saveOAuthClient(
  database: Database,
  client: OAuthClientInput,
  now: Date,
): Promise<OAuthClientRecord> {
  const values = {
    source: client.source,
    name: client.name,
    uri: client.uri ?? null,
    redirectUris: [...client.redirectUris],
    authMethod: client.authMethod,
    secretHash: client.secretHash ?? null,
    freshUntil: client.freshUntil ?? null,
    updatedAt: now,
  };
  const [row] = await drizzleOf(database)
    .insert(oauthClients)
    .values({ clientId: client.clientId, ...values })
    .onConflictDoUpdate({ target: [oauthClients.clientId], set: values })
    .returning(clientColumns);
  if (row === undefined) {
    throw new Error("client upsert returned no row");
  }
  return toClient(row);
}

export async function findOAuthClient(
  database: Database,
  clientId: string,
): Promise<OAuthClientRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(clientColumns)
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return row === undefined ? undefined : toClient(row);
}

/**
 * Removes the clients nobody ever allowed anything, written before `before`: registration is
 * open to anyone, and most registrations are never used again.
 */
export async function deleteUnusedOAuthClients(database: Database, before: Date): Promise<number> {
  const db = drizzleOf(database);
  const rows = await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.updatedAt, before),
        notExists(
          db
            .select({ id: oauthGrants.id })
            .from(oauthGrants)
            .where(eq(oauthGrants.oauthClientId, oauthClients.id)),
        ),
        notExists(
          db
            .select({ id: oauthCodes.id })
            .from(oauthCodes)
            .where(eq(oauthCodes.oauthClientId, oauthClients.id)),
        ),
      ),
    )
    .returning({ id: oauthClients.id });
  return rows.length;
}

/**
 * How many clients nobody ever allowed anything. Anyone can add one, so whoever adds them keeps
 * count and stops at a bound.
 */
export async function countUnusedOAuthClients(database: Database): Promise<number> {
  const db = drizzleOf(database);
  const [row] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(oauthClients)
    .where(
      notExists(
        db
          .select({ id: oauthGrants.id })
          .from(oauthGrants)
          .where(eq(oauthGrants.oauthClientId, oauthClients.id)),
      ),
    );
  return row?.count ?? 0;
}

export interface OAuthCodeRecord {
  /** The client's row id. */
  readonly oauthClientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: string;
  /** The resource as the client named it, and the canonical address it is. */
  readonly resource: string;
  readonly address: string;
}

export async function saveOAuthCode(
  database: Database,
  code: OAuthCodeRecord & { readonly codeHash: string; readonly expiresAt: Date },
): Promise<void> {
  await drizzleOf(database).insert(oauthCodes).values(code);
}

/**
 * Takes a code out of the table, so that it can be exchanged exactly once: whoever presents it
 * second finds nothing. `undefined` for a code that is unknown, used or expired.
 */
export async function takeOAuthCode(
  database: Database,
  codeHash: string,
  now: Date,
): Promise<OAuthCodeRecord | undefined> {
  const [row] = await drizzleOf(database)
    .delete(oauthCodes)
    .where(eq(oauthCodes.codeHash, codeHash))
    .returning({
      oauthClientId: oauthCodes.oauthClientId,
      userId: oauthCodes.userId,
      redirectUri: oauthCodes.redirectUri,
      codeChallenge: oauthCodes.codeChallenge,
      scope: oauthCodes.scope,
      resource: oauthCodes.resource,
      address: oauthCodes.address,
      expiresAt: oauthCodes.expiresAt,
    });
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) {
    return undefined;
  }
  const { expiresAt: _expiresAt, ...code } = row;
  return code;
}

/** An access token and the refresh token issued with it, as hashes. */
export interface OAuthTokenPair {
  readonly accessHash: string;
  readonly accessExpiresAt: Date;
  readonly refreshHash: string;
  readonly refreshExpiresAt: Date;
}

export interface OAuthGrantInput {
  readonly userId: string;
  /** The client's row id. */
  readonly oauthClientId: string;
  readonly address: string;
  readonly resource: string;
  readonly scope: string;
}

/**
 * Records what a user allowed a client, with the first tokens issued for it. A user keeps at
 * most `limits.grantsPerUser` grants: beyond that the ones used longest ago are ended, tokens
 * and all, so that nobody's table of grants grows without end.
 */
export async function createOAuthGrant(
  database: Database,
  grant: OAuthGrantInput,
  tokens: OAuthTokenPair,
  limits: { readonly grantsPerUser: number },
): Promise<string> {
  return drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .insert(oauthGrants)
      .values({ ...grant, expiresAt: tokens.refreshExpiresAt })
      .returning({ id: oauthGrants.id });
    if (row === undefined) {
      throw new Error("grant insert returned no row");
    }
    await tx.insert(oauthTokens).values({ grantId: row.id, ...tokens });
    const kept = tx
      .select({ id: oauthGrants.id })
      .from(oauthGrants)
      .where(eq(oauthGrants.userId, grant.userId))
      .orderBy(
        sql`coalesce(${oauthGrants.lastUsedAt}, ${oauthGrants.createdAt}) desc`,
        sql`${oauthGrants.id} desc`,
      )
      .limit(Math.max(1, limits.grantsPerUser));
    await tx
      .delete(oauthGrants)
      .where(and(eq(oauthGrants.userId, grant.userId), notInArray(oauthGrants.id, kept)));
    return row.id;
  });
}

export interface OAuthAccess {
  readonly grantId: string;
  readonly user: UserRecord;
  /** The only address the token is good for. */
  readonly address: string;
  readonly scope: string;
  readonly expiresAt: Date;
  /** When the grant was last noted as used; `undefined` when never. */
  readonly lastUsedAt: Date | undefined;
}

/** What an access token stands for, while it has not expired. */
export async function findOAuthAccess(
  database: Database,
  accessHash: string,
  now: Date,
): Promise<OAuthAccess | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      grantId: oauthGrants.id,
      address: oauthGrants.address,
      scope: oauthGrants.scope,
      lastUsedAt: oauthGrants.lastUsedAt,
      expiresAt: oauthTokens.accessExpiresAt,
      ...userColumns,
    })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(and(eq(oauthTokens.accessHash, accessHash), gt(oauthTokens.accessExpiresAt, now)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        grantId: row.grantId,
        user: toUser(row),
        address: row.address,
        scope: row.scope,
        expiresAt: row.expiresAt,
        lastUsedAt: row.lastUsedAt ?? undefined,
      };
}

export type OAuthRefreshOutcome =
  | {
      readonly status: "rotated";
      readonly grant: { readonly id: string; readonly resource: string; readonly scope: string };
    }
  /** Unknown, expired, or presented by another client than it was issued to. */
  | { readonly status: "invalid" }
  /** Used before, and not just now: the grant is gone with every token under it. */
  | { readonly status: "reused" };

/**
 * Exchanges a refresh token for the next pair. A refresh token is good once. Presented again
 * within `reuseGraceMs` of its first use, it is a client that retried or two that share one
 * store, and each gets a pair of its own; presented later, somebody else has it, and the grant
 * is revoked with everything issued under it. A grant keeps its `keepPairs` newest pairs and
 * no more: every exchange adds one, and a token presented again and again within the grace
 * would otherwise add one each time.
 */
export async function rotateOAuthRefresh(
  database: Database,
  input: {
    readonly refreshHash: string;
    /** The row id of the client presenting it. */
    readonly oauthClientId: string;
    readonly next: OAuthTokenPair;
    readonly now: Date;
    readonly reuseGraceMs: number;
    readonly keepPairs: number;
  },
): Promise<OAuthRefreshOutcome> {
  const { refreshHash, oauthClientId, next, now, reuseGraceMs, keepPairs } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .select({
        tokenId: oauthTokens.id,
        rotatedAt: oauthTokens.rotatedAt,
        refreshExpiresAt: oauthTokens.refreshExpiresAt,
        grantId: oauthGrants.id,
        oauthClientId: oauthGrants.oauthClientId,
        resource: oauthGrants.resource,
        scope: oauthGrants.scope,
      })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(eq(oauthTokens.refreshHash, refreshHash))
      .limit(1)
      // Two exchanges of one token wait for each other, so that both see the first use.
      .for("update", { of: oauthTokens });
    if (
      row === undefined ||
      row.oauthClientId !== oauthClientId ||
      row.refreshExpiresAt.getTime() <= now.getTime()
    ) {
      return { status: "invalid" };
    }
    if (row.rotatedAt !== null && now.getTime() - row.rotatedAt.getTime() > reuseGraceMs) {
      await tx.delete(oauthGrants).where(eq(oauthGrants.id, row.grantId));
      return { status: "reused" };
    }
    if (row.rotatedAt === null) {
      await tx.update(oauthTokens).set({ rotatedAt: now }).where(eq(oauthTokens.id, row.tokenId));
    }
    await tx.insert(oauthTokens).values({ grantId: row.grantId, ...next });
    // Ids are made in order of time, so the greatest are the newest.
    const kept = tx
      .select({ id: oauthTokens.id })
      .from(oauthTokens)
      .where(eq(oauthTokens.grantId, row.grantId))
      .orderBy(sql`${oauthTokens.id} desc`)
      .limit(Math.max(2, keepPairs));
    await tx
      .delete(oauthTokens)
      .where(and(eq(oauthTokens.grantId, row.grantId), notInArray(oauthTokens.id, kept)));
    await tx
      .update(oauthGrants)
      .set({ expiresAt: next.refreshExpiresAt, lastUsedAt: now })
      .where(eq(oauthGrants.id, row.grantId));
    return {
      status: "rotated",
      grant: { id: row.grantId, resource: row.resource, scope: row.scope },
    };
  });
}

/** Notes that a grant was used. The caller decides how often that is worth a write. */
export async function touchOAuthGrant(
  database: Database,
  grantId: string,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(oauthGrants)
    .set({ lastUsedAt: now })
    .where(eq(oauthGrants.id, grantId));
}

export interface OAuthGrantRecord {
  readonly id: string;
  readonly client: { readonly name: string; readonly uri: string | undefined };
  readonly address: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | undefined;
}

/** What the user allowed and can still be renewed, newest first. */
export async function listOAuthGrants(
  database: Database,
  userId: string,
  now: Date,
): Promise<OAuthGrantRecord[]> {
  const rows = await drizzleOf(database)
    .select({
      id: oauthGrants.id,
      name: oauthClients.name,
      uri: oauthClients.uri,
      address: oauthGrants.address,
      createdAt: oauthGrants.createdAt,
      lastUsedAt: oauthGrants.lastUsedAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.oauthClientId))
    .where(and(eq(oauthGrants.userId, userId), gt(oauthGrants.expiresAt, now)))
    .orderBy(sql`${oauthGrants.createdAt} desc`, sql`${oauthGrants.id} desc`);
  return rows.map((row) => ({
    id: row.id,
    client: { name: row.name, uri: row.uri ?? undefined },
    address: row.address,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
  }));
}

/** Takes back what the user allowed; the tokens go with it. True when the grant was theirs. */
export async function deleteOAuthGrant(
  database: Database,
  grant: { readonly userId: string; readonly grantId: string },
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(oauthGrants)
    .where(and(eq(oauthGrants.id, grant.grantId), eq(oauthGrants.userId, grant.userId)))
    .returning({ id: oauthGrants.id });
  return rows.length > 0;
}

/**
 * Revokes the grant a token belongs to, whichever of its two tokens is presented, when the
 * client presenting it is the one it was issued to. True when a grant went.
 */
export async function revokeOAuthToken(
  database: Database,
  token: { readonly tokenHash: string; readonly oauthClientId: string },
): Promise<boolean> {
  const db = drizzleOf(database);
  const rows = await db
    .delete(oauthGrants)
    .where(
      and(
        eq(oauthGrants.oauthClientId, token.oauthClientId),
        sql`${oauthGrants.id} in ${db
          .select({ grantId: oauthTokens.grantId })
          .from(oauthTokens)
          .where(
            or(
              eq(oauthTokens.accessHash, token.tokenHash),
              eq(oauthTokens.refreshHash, token.tokenHash),
            ),
          )}`,
      ),
    )
    .returning({ id: oauthGrants.id });
  return rows.length > 0;
}

/** Removes what time has ended: codes, grants nothing can renew, and tokens past both ends. */
export async function deleteExpiredOAuth(
  database: Database,
  now: Date,
): Promise<{ readonly codes: number; readonly grants: number; readonly tokens: number }> {
  const db = drizzleOf(database);
  const codes = await db
    .delete(oauthCodes)
    .where(lte(oauthCodes.expiresAt, now))
    .returning({ id: oauthCodes.id });
  const grants = await db
    .delete(oauthGrants)
    .where(lte(oauthGrants.expiresAt, now))
    .returning({ id: oauthGrants.id });
  const tokens = await db
    .delete(oauthTokens)
    .where(lte(oauthTokens.refreshExpiresAt, now))
    .returning({ id: oauthTokens.id });
  return { codes: codes.length, grants: grants.length, tokens: tokens.length };
}
