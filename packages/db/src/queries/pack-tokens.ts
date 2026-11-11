import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { packTokens } from "../schema.js";

// Tokens the operator makes for the packs of the deployment's own directory (ADR-0088). The
// table holds the hash of each secret and never the secret; a row names one pack, as
// `owner/name` in the spelling of an address, or no pack, which is every pack of the directory.

export interface PackTokenRecord {
  readonly id: string;
  /** `owner/name` of the one pack the token reads, or null for every pack of the directory. */
  readonly pack: string | null;
  readonly label: string;
  readonly createdAt: Date;
  /** Null for a token made without an end. */
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
}

const columns = {
  id: packTokens.id,
  pack: packTokens.pack,
  label: packTokens.label,
  createdAt: packTokens.createdAt,
  expiresAt: packTokens.expiresAt,
  lastUsedAt: packTokens.lastUsedAt,
};

/** Not ended: made without an end, or with one still ahead. */
const live = (now: Date) => or(isNull(packTokens.expiresAt), gt(packTokens.expiresAt, now));

/**
 * Stores a new token by its hash. `undefined` when the deployment holds as many as `limit`
 * that have not ended; none is ended to make room.
 */
export async function createPackToken(
  database: Database,
  input: {
    readonly pack: string | null;
    readonly label: string;
    readonly tokenHash: string;
    readonly expiresAt: Date | undefined;
    readonly now: Date;
  },
  limit: number,
): Promise<PackTokenRecord | undefined> {
  return drizzleOf(database).transaction(async (tx) => {
    const [held] = await tx
      .select({ count: sql<number>`count(*)::integer` })
      .from(packTokens)
      .where(live(input.now));
    if ((held?.count ?? 0) >= limit) {
      return undefined;
    }
    const [row] = await tx
      .insert(packTokens)
      .values({
        pack: input.pack,
        label: input.label,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt ?? null,
        createdAt: input.now,
      })
      .returning(columns);
    return row;
  });
}

/** The token with this hash, when it has not ended. */
export async function findPackToken(
  database: Database,
  tokenHash: string,
  now: Date,
): Promise<PackTokenRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(columns)
    .from(packTokens)
    .where(and(eq(packTokens.tokenHash, tokenHash), live(now)))
    .limit(1);
  return row;
}

/** The tokens that have not ended, newest first. */
export async function listPackTokens(database: Database, now: Date): Promise<PackTokenRecord[]> {
  return drizzleOf(database)
    .select(columns)
    .from(packTokens)
    .where(live(now))
    .orderBy(desc(packTokens.createdAt), packTokens.id);
}

/** Takes a token back, which ends it at once. False when there was none. */
export async function deletePackToken(database: Database, id: string): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(packTokens)
    .where(eq(packTokens.id, id))
    .returning({ id: packTokens.id });
  return rows.length > 0;
}

/** Notes that a token was used. */
export async function touchPackToken(database: Database, id: string, now: Date): Promise<void> {
  await drizzleOf(database)
    .update(packTokens)
    .set({ lastUsedAt: now })
    .where(eq(packTokens.id, id));
}
