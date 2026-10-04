import type { Clock } from "@skillcdn/core";
import {
  createSession,
  type Database,
  deleteSession,
  findSession,
  touchSession,
  type UserRecord,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { hashToken, newToken } from "./secrets.js";

// A browser a person is signed in on (docs/specs/permissions.md). The cookie holds a random
// token and the database its hash, so the `api` role keeps no session of its own and any
// replica answers any request.

/** How often a session in use is noted as used, and its end moved: not on every request. */
const TOUCH_INTERVAL_MS = 60 * 60_000;
const COOKIE_NAME = "skillcdn_session";

/** The value of the cookie `name` in a Cookie header, or nothing. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length === 0 ? undefined : value;
    }
  }
  return undefined;
}

/**
 * A Set-Cookie value for a cookie only this server reads: not for scripts, not for other sites'
 * requests, and only over TLS when the deployment is served over it. A `maxAgeSeconds` of zero
 * takes the cookie away.
 */
export function writeCookie(
  name: string,
  value: string,
  options: { readonly path: string; readonly maxAgeSeconds: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

export interface SessionsOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How long a session lasts without being used. */
  readonly ttlMs: number;
  /** Whether the deployment is served over TLS, which is what the cookie is then bound to. */
  readonly secure: boolean;
}

export class Sessions {
  readonly #options: SessionsOptions;
  /** With the `__Host-` prefix a browser only accepts the cookie from this very host, over TLS. */
  readonly #cookie: string;

  constructor(options: SessionsOptions) {
    this.#options = options;
    this.#cookie = options.secure ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
  }

  /** Starts a session for the user and answers with the cookie that carries it. */
  async start(user: UserRecord): Promise<string> {
    const { database, clock, ttlMs, secure } = this.#options;
    const token = newToken("scdn_s_");
    const now = clock.now();
    await createSession(database, {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + ttlMs),
      now,
    });
    return writeCookie(this.#cookie, token, {
      path: "/",
      maxAgeSeconds: Math.floor(ttlMs / 1000),
      secure,
    });
  }

  /** Whether a request carries a session at all, which costs nothing to tell. */
  carriedBy(cookieHeader: string | null | undefined): boolean {
    return readCookie(cookieHeader, this.#cookie) !== undefined;
  }

  /** Who the request's cookie says is signed in, or nobody. */
  async resolve(cookieHeader: string | null | undefined): Promise<UserRecord | undefined> {
    const token = readCookie(cookieHeader, this.#cookie);
    if (token === undefined) {
      return undefined;
    }
    const { database, clock, ttlMs, logger } = this.#options;
    const now = clock.now();
    const session = await findSession(database, hashToken(token), now);
    if (session === undefined) {
      return undefined;
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      // A session lives as long as it is used. The answer does not wait for the note.
      touchSession(database, session.id, {
        now,
        expiresAt: new Date(now.getTime() + ttlMs),
      }).catch((error: unknown) => {
        logger.warn({ err: error }, "a session could not be noted as used");
      });
    }
    return session.user;
  }

  /** Ends the session the cookie names, and answers with the cookie that takes it away. */
  async end(cookieHeader: string | null | undefined): Promise<string> {
    const token = readCookie(cookieHeader, this.#cookie);
    if (token !== undefined) {
      await deleteSession(this.#options.database, hashToken(token));
    }
    return this.clear();
  }

  /** The cookie that takes a session away from the browser, whatever it was. */
  clear(): string {
    return writeCookie(this.#cookie, "", {
      path: "/",
      maxAgeSeconds: 0,
      secure: this.#options.secure,
    });
  }
}
