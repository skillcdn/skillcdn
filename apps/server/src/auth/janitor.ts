import type { Clock } from "@skillcdn/core";
import {
  type Database,
  deleteExpiredOAuth,
  deleteExpiredSessions,
  deleteStaleRepoPermissions,
  deleteUnusedOAuthClients,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";

/** A registration nobody allowed anything within this long was a one-off. */
const UNUSED_CLIENT_MS = 7 * 24 * 60 * 60_000;
/** An answer of the git host this old is trusted by nothing, whatever the configured lifetime. */
const STALE_PERMISSION_MS = 24 * 60 * 60_000;

/**
 * Removes what time has ended: sessions, codes, tokens and grants past their end, answers of
 * the git host nobody trusts any more, and clients that registered and never came back. None of
 * it is needed for correctness, since every read checks the time itself; this only keeps the
 * tables from growing. Every process may run it: deleting twice deletes once.
 */
export class AuthJanitor {
  readonly #database: Database;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly clock: Clock;
    readonly logger: Logger;
  }) {
    this.#database = options.database;
    this.#clock = options.clock;
    this.#logger = options.logger;
  }

  /** One pass. Resolves when it is done, or given up on: a failed pass is the next one's work. */
  sweep(): Promise<void> {
    this.#running = this.#running.then(async () => {
      const now = this.#clock.now();
      try {
        const sessions = await deleteExpiredSessions(this.#database, now);
        const oauth = await deleteExpiredOAuth(this.#database, now);
        const permissions = await deleteStaleRepoPermissions(
          this.#database,
          new Date(now.getTime() - STALE_PERMISSION_MS),
        );
        const clients = await deleteUnusedOAuthClients(
          this.#database,
          new Date(now.getTime() - UNUSED_CLIENT_MS),
        );
        if (sessions + oauth.codes + oauth.grants + oauth.tokens + permissions + clients > 0) {
          this.#logger.info(
            { sessions, ...oauth, permissions, clients },
            "expired sign-in state removed",
          );
        }
      } catch (error) {
        this.#logger.warn({ err: error }, "expired sign-in state was not removed");
      }
    });
    return this.#running;
  }

  start(intervalMs: number): void {
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => void this.sweep(), intervalMs);
      this.#timer.unref();
    }
  }

  /** Stops the timer and waits for a pass that is under way. */
  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }
}
