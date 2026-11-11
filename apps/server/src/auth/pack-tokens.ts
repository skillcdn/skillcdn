import { type Address, type Clock, LOCAL_HOST_KEY } from "@skillcdn/core";
import {
  createPackToken,
  type Database,
  deletePackToken,
  findPackToken,
  listPackTokens,
  type PackTokenRecord,
  touchPackToken,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { hashToken, newToken } from "./secrets.js";

// Tokens for the packs of the deployment's own directory (docs/specs/permissions.md, ADR-0088).
// A deployment that reads its packs with a token only has no git host to ask who may see what:
// its operator says it, by making a token for one pack or for every pack and handing it to the
// agent that reads. A token is a random string stored as its hash, like every other secret
// handed out here; it ends at its time or when the operator takes it back, at once.

/** What a pack token begins with, so that whoever finds one knows what it found. */
export const PACK_TOKEN_PREFIX = "scdn_pack_";
/** How many tokens a deployment holds at once. */
export const MAX_PACK_TOKENS = 1000;
export const PACK_TOKEN_MAX_DAYS = 366;
export const PACK_TOKEN_MAX_LABEL_LENGTH = 100;
/** How often a token in use is noted as used. */
const TOUCH_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

export interface PackTokensOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The pack of an address as a token names it: `owner/name`, as the address spells them. */
const packOf = (address: Address): string => `${address.owner}/${address.repo}`;

export class PackTokens {
  readonly #options: PackTokensOptions;

  constructor(options: PackTokensOptions) {
    this.#options = options;
  }

  /**
   * Makes a token for one pack, or for every pack of the directory when no address is given,
   * and answers with the secret, this once. `undefined` when the deployment holds as many as
   * it may.
   */
  async create(input: {
    readonly address: Address | undefined;
    readonly label: string;
    readonly expiresInDays: number | null;
  }): Promise<{ readonly token: string; readonly record: PackTokenRecord } | undefined> {
    const { database, clock } = this.#options;
    const now = clock.now();
    const token = newToken(PACK_TOKEN_PREFIX);
    const record = await createPackToken(
      database,
      {
        pack: input.address === undefined ? null : packOf(input.address),
        label: input.label,
        tokenHash: hashToken(token),
        expiresAt:
          input.expiresInDays === null
            ? undefined
            : new Date(now.getTime() + input.expiresInDays * DAY_MS),
        now,
      },
      MAX_PACK_TOKENS,
    );
    return record === undefined ? undefined : { token, record };
  }

  list(): Promise<PackTokenRecord[]> {
    return listPackTokens(this.#options.database, this.#options.clock.now());
  }

  /** Takes a token back, which ends it at once. True when there was one. */
  remove(id: string): Promise<boolean> {
    return deletePackToken(this.#options.database, id);
  }

  /**
   * Whether what a request presents reads the pack of the address: a token of this kind that
   * has not ended, made for that pack or for every pack. Anything else reads nothing, in one
   * answer for a token that is unknown, ended, taken back or another pack's.
   */
  async verify(presented: string, address: Address): Promise<boolean> {
    const { database, clock, logger } = this.#options;
    if (address.host !== LOCAL_HOST_KEY || !presented.startsWith(PACK_TOKEN_PREFIX)) {
      return false;
    }
    const now = clock.now();
    const record = await findPackToken(database, hashToken(presented), now);
    if (record === undefined || (record.pack !== null && record.pack !== packOf(address))) {
      return false;
    }
    if (
      record.lastUsedAt === null ||
      now.getTime() - record.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS
    ) {
      // The answer does not wait for the note.
      touchPackToken(database, record.id, now).catch((error: unknown) => {
        logger.warn({ err: error }, "a pack token could not be noted as used");
      });
    }
    return true;
  }
}
