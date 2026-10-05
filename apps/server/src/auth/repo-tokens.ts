import { type Address, type Clock, REPO_TOKEN_PREFIX } from "@skillcdn/core";
import {
  createRepoToken,
  type Database,
  deleteRepoToken,
  findRepoTokenAccess,
  listRepoTokens,
  type RepoRecord,
  type RepoTokenAccess,
  type RepoTokenRecord,
  touchRepoToken,
  type UserRecord,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { repositoryKey } from "../mounts/mount-service.js";
import { hashToken, newToken } from "./secrets.js";

/** How many tokens a person may hold at once. */
export const MAX_REPO_TOKENS_PER_USER = 50;
/** How often a token in use is noted as used. */
const TOUCH_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

export interface RepoTokensOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Tokens for agents that have nobody to sign in: a job, a server (docs/specs/permissions.md,
 * ADR-0040). A person makes one for a repository they can open, and whoever presents it reads
 * that repository as them, at any ref and path, until it expires or is taken back. It is a
 * random string stored as a hash, like every other secret handed out here, and it says who made
 * it, never what they may see: every request made with it asks the git host, as that person.
 */
export class RepoTokens {
  readonly #options: RepoTokensOptions;

  constructor(options: RepoTokensOptions) {
    this.#options = options;
  }

  /**
   * Makes a token for the repository, which the caller resolved for the user a moment ago, and
   * answers with the secret, this once. `undefined` when the user holds as many as one may.
   */
  async create(
    user: UserRecord,
    repo: RepoRecord,
    address: Address,
    input: { readonly label: string; readonly expiresInDays: number },
  ): Promise<{ readonly token: string; readonly record: RepoTokenRecord } | undefined> {
    const { database, clock } = this.#options;
    const now = clock.now();
    const token = newToken(REPO_TOKEN_PREFIX);
    const record = await createRepoToken(
      database,
      {
        userId: user.id,
        repoId: repo.id,
        address: repositoryKey(address),
        label: input.label,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
        now,
      },
      MAX_REPO_TOKENS_PER_USER,
    );
    return record === undefined ? undefined : { token, record };
  }

  list(user: UserRecord): Promise<RepoTokenRecord[]> {
    return listRepoTokens(this.#options.database, user.id, this.#options.clock.now());
  }

  /** Takes a token back, which ends it at once. True when it was this user's. */
  remove(user: UserRecord, tokenId: string): Promise<boolean> {
    return deleteRepoToken(this.#options.database, { userId: user.id, tokenId });
  }

  /**
   * Who a token stands for at an address: its maker, when the address is one of the repository
   * the token was made for, under the name it was made for. The caller still has to resolve
   * the address for that person, and to see that the name still means the repository
   * ({@link RepoTokenAccess.repoId}): a name can be given to another repository.
   */
  async verify(token: string, address: Address): Promise<RepoTokenAccess | undefined> {
    const { database, clock, logger } = this.#options;
    const now = clock.now();
    const access = await findRepoTokenAccess(database, hashToken(token), now);
    if (access === undefined || access.address !== repositoryKey(address)) {
      return undefined;
    }
    if (
      access.lastUsedAt === undefined ||
      now.getTime() - access.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS
    ) {
      // The answer does not wait for the note.
      touchRepoToken(database, access.tokenId, now).catch((error: unknown) => {
        logger.warn({ err: error }, "a token could not be noted as used");
      });
    }
    return access;
  }
}
