import { and, count, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { connectRequests } from "../schema.js";

// A command connecting with a code a person approves (docs/specs/permissions.md, ADR-0059).
// Identity data: a row is named by its code, for the person, or by the hash of the secret, for
// the command, and never listed. Nothing secret rests here: the secret is a hash, and the token
// is made when the command claims it, outside this package.

/** What a person agreed to, once they did. */
export interface ConnectApproval {
  readonly userId: string;
  readonly label: string;
  /** How many days the token is to be good for; `null` for a token without an end. */
  readonly expiresInDays: number | null;
  readonly at: Date;
}

export interface ConnectRequestRecord {
  readonly id: string;
  readonly code: string;
  /** The repository the command asks to read: canonical, without a ref or a path. */
  readonly address: string;
  /** What the command calls itself. */
  readonly agent: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** `undefined` while nobody has approved. */
  readonly approval: ConnectApproval | undefined;
}

export interface ConnectRequestInput {
  readonly code: string;
  /** The hash of the secret; the secret itself never reaches this package. */
  readonly secretHash: string;
  readonly address: string;
  readonly agent: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

const recordColumns = {
  id: connectRequests.id,
  code: connectRequests.code,
  address: connectRequests.address,
  agent: connectRequests.agent,
  createdAt: connectRequests.createdAt,
  expiresAt: connectRequests.expiresAt,
  approvedBy: connectRequests.approvedBy,
  approvedAt: connectRequests.approvedAt,
  label: connectRequests.label,
  expiresInDays: connectRequests.expiresInDays,
};

type RecordRow = {
  readonly id: string;
  readonly code: string;
  readonly address: string;
  readonly agent: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly label: string | null;
  readonly expiresInDays: number | null;
};

const toRecord = (row: RecordRow): ConnectRequestRecord => ({
  id: row.id,
  code: row.code,
  address: row.address,
  agent: row.agent,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  approval:
    row.approvedBy === null || row.approvedAt === null || row.label === null
      ? undefined
      : {
          userId: row.approvedBy,
          label: row.label,
          expiresInDays: row.expiresInDays,
          at: row.approvedAt,
        },
});

/**
 * Stores a request. An unauthenticated route is bounded: with `limit` requests that have not
 * expired, nothing is stored and the answer is `undefined`. A code or a secret hash a live row
 * holds already fails the insert, as the unique keys say.
 */
export async function createConnectRequest(
  database: Database,
  input: ConnectRequestInput,
  limit: number,
): Promise<ConnectRequestRecord | undefined> {
  return drizzleOf(database).transaction(async (tx) => {
    const [waiting] = await tx
      .select({ count: count() })
      .from(connectRequests)
      .where(gt(connectRequests.expiresAt, input.now));
    if ((waiting?.count ?? 0) >= limit) {
      return undefined;
    }
    const [row] = await tx
      .insert(connectRequests)
      .values({
        code: input.code,
        secretHash: input.secretHash,
        address: input.address,
        agent: input.agent,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      })
      .returning(recordColumns);
    if (row === undefined) {
      throw new Error("connect request insert returned no row");
    }
    return toRecord(row);
  });
}

/** The request under a code, while it has not expired. */
export async function findConnectRequestByCode(
  database: Database,
  code: string,
  now: Date,
): Promise<ConnectRequestRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(recordColumns)
    .from(connectRequests)
    .where(and(eq(connectRequests.code, code), gt(connectRequests.expiresAt, now)))
    .limit(1);
  return row === undefined ? undefined : toRecord(row);
}

/** The request a secret names, while it has not expired. */
export async function findConnectRequestBySecret(
  database: Database,
  secretHash: string,
  now: Date,
): Promise<ConnectRequestRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(recordColumns)
    .from(connectRequests)
    .where(and(eq(connectRequests.secretHash, secretHash), gt(connectRequests.expiresAt, now)))
    .limit(1);
  return row === undefined ? undefined : toRecord(row);
}

/**
 * Records a yes on a request nobody has approved yet. False when there is no such request to
 * approve: unknown, expired, or approved already.
 */
export async function approveConnectRequest(
  database: Database,
  approval: {
    readonly code: string;
    readonly userId: string;
    readonly label: string;
    readonly expiresInDays: number | null;
    readonly now: Date;
  },
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .update(connectRequests)
    .set({
      approvedBy: approval.userId,
      approvedAt: approval.now,
      label: approval.label,
      expiresInDays: approval.expiresInDays,
    })
    .where(
      and(
        eq(connectRequests.code, approval.code),
        gt(connectRequests.expiresAt, approval.now),
        isNull(connectRequests.approvedBy),
      ),
    )
    .returning({ id: connectRequests.id });
  return rows.length > 0;
}

/** Ends a request: a person said no, or a claim could not be met. True when there was one. */
export async function deleteConnectRequest(database: Database, id: string): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(connectRequests)
    .where(eq(connectRequests.id, id))
    .returning({ id: connectRequests.id });
  return rows.length > 0;
}

/**
 * Takes an approved request out of the table by its secret, so that it is claimed exactly once:
 * whoever presents the secret second finds nothing. `undefined` for a secret that names no
 * approved request that has not expired.
 */
export async function takeApprovedConnectRequest(
  database: Database,
  secretHash: string,
  now: Date,
): Promise<ConnectRequestRecord | undefined> {
  const [row] = await drizzleOf(database)
    .delete(connectRequests)
    .where(
      and(
        eq(connectRequests.secretHash, secretHash),
        gt(connectRequests.expiresAt, now),
        isNotNull(connectRequests.approvedBy),
      ),
    )
    .returning(recordColumns);
  return row === undefined ? undefined : toRecord(row);
}

export async function deleteExpiredConnectRequests(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(connectRequests)
    .where(lte(connectRequests.expiresAt, now))
    .returning({ id: connectRequests.id });
  return rows.length;
}
