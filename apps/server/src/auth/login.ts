import { randomBytes } from "node:crypto";
import {
  AUTH_ROUTES,
  type Clock,
  GitHostError,
  type GitHostKey,
  type GitHostLogin,
  type SignInFailure,
  signInPath,
} from "@skillcdn/core";
import { type Database, saveLogin, type UserRecord } from "@skillcdn/db";
import * as z from "zod";
import type { Logger } from "../logger.js";
import type { UserCredentials } from "./credentials.js";
import { openJson, pkceChallenge, type Secrets, sameSecret, sealJson } from "./secrets.js";
import { readCookie, type Sessions, writeCookie } from "./sessions.js";

// Signing in through the git host (docs/specs/permissions.md). The browser leaves for the host
// with a cookie that remembers what it left for, and comes back with a code; the code becomes
// the host's credential, which stays here, and a session, which is all the browser gets. What
// did not complete goes back to the page it was for, which says so and offers to try again.

/** The git host people sign in through. */
export const LOGIN_HOST: GitHostKey = "gh";

const LOGIN_COOKIE = "skillcdn_login";
/** How long a person has to sign in at the host before the attempt is forgotten. */
const LOGIN_TTL_MS = 10 * 60_000;
const MAX_RETURN_TO_LENGTH = 2048;

const pendingSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  returnTo: z.string().min(1),
});

/**
 * The page to come back to, when it is a page of this origin, and the front page otherwise: a
 * sign-in link must not be a way to send someone to another site.
 */
export function safeReturnTo(value: string | undefined, origin: string): string {
  if (
    value === undefined ||
    value.length > MAX_RETURN_TO_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  const url = URL.parse(value, origin);
  if (url === null || url.origin !== origin) {
    return "/";
  }
  // What is returned is read again by a browser, so it is checked as it will be read: removing
  // dot segments can leave a path that starts with two slashes ("/.//host"), which is the host
  // of another site, not a path of this one.
  const path = `${url.pathname}${url.search}`;
  return path.startsWith("//") ? "/" : path;
}

export interface LoginOptions {
  readonly database: Database;
  readonly login: GitHostLogin;
  readonly credentials: UserCredentials;
  readonly sessions: Sessions;
  readonly secrets: Secrets;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The origin people use: where the git host sends them back to. */
  readonly origin: string;
  /** Whether that origin is served over TLS. */
  readonly secure: boolean;
}

export interface LoginStep {
  /** Where the browser goes next. */
  readonly redirect: string;
  /** Set-Cookie values to send with the redirect. */
  readonly cookies: readonly string[];
}

export class Login {
  readonly #options: LoginOptions;

  constructor(options: LoginOptions) {
    this.#options = options;
  }

  get #redirectUri(): string {
    return `${this.#options.origin}${AUTH_ROUTES.callback}`;
  }

  /**
   * Over TLS the cookie carries the `__Host-` prefix, so that only this very host can have set
   * it: a sign-in somebody else began cannot be planted in a browser from a neighbouring host
   * and finished there. The prefix needs the whole origin as its path; without TLS, which is
   * development, only the callback's path gets the cookie.
   */
  get #cookieName(): string {
    return this.#options.secure ? `__Host-${LOGIN_COOKIE}` : LOGIN_COOKIE;
  }

  #cookie(value: string, maxAgeSeconds: number): string {
    return writeCookie(this.#cookieName, value, {
      path: this.#options.secure ? "/" : "/auth",
      maxAgeSeconds,
      secure: this.#options.secure,
    });
  }

  /** Sends the browser to the git host, remembering where it wanted to go afterwards. */
  begin(returnTo: string | undefined): LoginStep {
    const { login, secrets, clock, origin } = this.#options;
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const pending = sealJson(
      secrets,
      "login",
      { state, verifier, returnTo: safeReturnTo(returnTo, origin) },
      new Date(clock.now().getTime() + LOGIN_TTL_MS),
    );
    return {
      redirect: login.authorizationUrl({
        state,
        redirectUri: this.#redirectUri,
        codeChallenge: pkceChallenge(verifier),
      }),
      cookies: [this.#cookie(pending, Math.floor(LOGIN_TTL_MS / 1000))],
    };
  }

  /**
   * Finishes a sign-in with what the git host sent the browser back with. Whatever happens, the
   * browser is sent on to the page it left for: signed in, or asked to open the sign-in dialog
   * with what went wrong.
   */
  async complete(
    query: { readonly code?: string; readonly state?: string; readonly error?: string },
    cookieHeader: string | null | undefined,
  ): Promise<LoginStep> {
    const { secrets, clock, logger, origin } = this.#options;
    const forget = this.#cookie("", 0);
    /**
     * Back to the page this attempt was for, which says what happened over itself and offers to
     * try again (ADR-0043): the front page, once the browser no longer carries which that was.
     */
    const failed = (failure: SignInFailure, returnTo?: string): LoginStep => ({
      redirect: signInPath(safeReturnTo(returnTo, origin), failure),
      cookies: [forget],
    });

    const sealed = readCookie(cookieHeader, this.#cookieName);
    const pending =
      sealed === undefined
        ? undefined
        : pendingSchema.safeParse(openJson(secrets, "login", sealed, clock.now()));
    if (pending === undefined || !pending.success) {
      return failed("expired");
    }
    const { returnTo } = pending.data;
    // The answer has to be to the question this browser asked, or someone else's sign-in
    // could be finished in it.
    if (query.state === undefined || !sameSecret(query.state, pending.data.state)) {
      return failed("failed", returnTo);
    }
    if (query.code === undefined) {
      return failed(query.error === "access_denied" ? "denied" : "failed", returnTo);
    }
    let user: UserRecord;
    try {
      user = await this.#signIn(query.code, pending.data.verifier);
    } catch (error) {
      if (!(error instanceof GitHostError)) {
        throw error;
      }
      logger.warn({ err: error, kind: error.kind }, "a sign-in did not complete");
      return failed("failed", returnTo);
    }
    return {
      // Checked when it was sealed, and again here: where a browser is sent never rests on the
      // seal alone.
      redirect: safeReturnTo(returnTo, origin),
      cookies: [forget, await this.#options.sessions.start(user)],
    };
  }

  async #signIn(code: string, verifier: string): Promise<UserRecord> {
    const { database, login, credentials, clock } = this.#options;
    const issued = await login.exchangeCode({
      code,
      redirectUri: this.#redirectUri,
      codeVerifier: verifier,
    });
    const hostUser = await login.getUser(issued.accessToken);
    const user = await saveLogin(database, { host: LOGIN_HOST, user: hostUser, now: clock.now() });
    await credentials.store(user.id, issued);
    return user;
  }
}
