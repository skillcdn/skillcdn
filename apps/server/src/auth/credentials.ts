import {
  type Clock,
  DomainError,
  GitHostError,
  type GitHostLogin,
  type HostCredentials,
} from "@skillcdn/core";
import {
  type Database,
  deleteUserCredentials,
  forgetUserAccess,
  getUserCredentials,
  type StoredCredentials,
  saveUserCredentials,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import type { Secrets } from "./secrets.js";

/**
 * The git host no longer accepts what it issued this person, and nothing here can renew it:
 * they have to sign in again. Everything that stood on the credential is gone with it.
 */
export class CredentialsLostError extends DomainError {
  constructor() {
    super("auth.credentials_lost", "the git host no longer accepts the user's credential");
  }
}

export interface UserCredentialsOptions {
  readonly database: Database;
  readonly login: GitHostLogin;
  readonly secrets: Secrets;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** How long before its end an access token is renewed rather than used. */
const EXPIRY_MARGIN_MS = 60_000;
/** How long to wait for another process that is renewing the same credential to write it down. */
const RENEWAL_RACE_MS = 400;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The git host's credential of each user (docs/specs/permissions.md): encrypted at rest, read
 * only here, handed only to the host adapter, and renewed when the host issues expiring ones.
 */
export class UserCredentials {
  readonly #options: UserCredentialsOptions;
  /** Requests of one user that find the token expired share one renewal. */
  readonly #renewing = new Map<string, Promise<string>>();

  constructor(options: UserCredentialsOptions) {
    this.#options = options;
  }

  /** Stores what the host issued at sign-in, in place of whatever was stored. */
  async store(userId: string, credentials: HostCredentials): Promise<void> {
    const { database, clock } = this.#options;
    await saveUserCredentials(database, userId, this.#sealed(userId, credentials), clock.now());
  }

  /**
   * A token the host accepts for the user right now. Rejects with {@link CredentialsLostError}
   * when there is none and none can be had, and with a `GitHostError` when the host could not
   * be asked for a new one.
   */
  async accessToken(userId: string): Promise<string> {
    const { database, clock, secrets } = this.#options;
    const stored = await getUserCredentials(database, userId);
    if (stored === undefined) {
      throw new CredentialsLostError();
    }
    const usableUntil = stored.accessExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (usableUntil - clock.now().getTime() > EXPIRY_MARGIN_MS) {
      const token = secrets.open("host-credential", stored.accessToken, userId);
      if (token !== undefined) {
        return token;
      }
      // Written under another secret: unreadable for good.
      await this.#forget(userId, stored);
      throw new CredentialsLostError();
    }
    let renewing = this.#renewing.get(userId);
    if (renewing === undefined) {
      renewing = this.#renew(userId, stored).finally(() => {
        this.#renewing.delete(userId);
      });
      this.#renewing.set(userId, renewing);
    }
    return renewing;
  }

  /**
   * The host refused a token this handed out: what is stored is forgotten, with every session
   * and grant that stood on it. Always rejects with {@link CredentialsLostError}.
   */
  async refused(userId: string): Promise<never> {
    const stored = await getUserCredentials(this.#options.database, userId);
    if (stored !== undefined) {
      await this.#forget(userId, stored);
    }
    throw new CredentialsLostError();
  }

  async #renew(userId: string, stored: StoredCredentials): Promise<string> {
    const { database, login, secrets, clock, logger } = this.#options;
    const refreshToken =
      stored.refreshToken === undefined
        ? undefined
        : secrets.open("host-credential", stored.refreshToken, userId);
    const refreshUntil = stored.refreshExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (refreshToken === undefined || refreshUntil <= clock.now().getTime()) {
      await this.#forget(userId, stored);
      throw new CredentialsLostError();
    }
    try {
      const renewed = await login.refresh(refreshToken);
      await saveUserCredentials(database, userId, this.#sealed(userId, renewed), clock.now());
      return renewed.accessToken;
    } catch (error) {
      if (!(error instanceof GitHostError) || error.kind !== "unauthorized") {
        throw error;
      }
      // A refresh token is good once. Another process may have used it a moment ago and be
      // about to write down what it got: that is a renewal, not a loss.
      await sleep(RENEWAL_RACE_MS);
      const current = await getUserCredentials(database, userId);
      if (current !== undefined && current.accessToken !== stored.accessToken) {
        const token = secrets.open("host-credential", current.accessToken, userId);
        if (token !== undefined) {
          return token;
        }
      }
      logger.info({ user: userId }, "the git host refused a user's refresh token");
      await this.#forget(userId, stored);
      throw new CredentialsLostError();
    }
  }

  /** Forgets `stored` unless someone replaced it meanwhile, and what stood on it. */
  async #forget(userId: string, stored: StoredCredentials): Promise<void> {
    const { database } = this.#options;
    if (await deleteUserCredentials(database, userId, { accessToken: stored.accessToken })) {
      await forgetUserAccess(database, userId);
    }
  }

  #sealed(userId: string, credentials: HostCredentials): StoredCredentials {
    const { secrets } = this.#options;
    return {
      accessToken: secrets.seal("host-credential", credentials.accessToken, userId),
      accessExpiresAt: credentials.accessExpiresAt,
      refreshToken:
        credentials.refreshToken === undefined
          ? undefined
          : secrets.seal("host-credential", credentials.refreshToken, userId),
      refreshExpiresAt: credentials.refreshExpiresAt,
    };
  }
}
