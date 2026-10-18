import { randomInt } from "node:crypto";
import {
  type Address,
  type Clock,
  CONNECT_CODE_ALPHABET,
  CONNECT_CODE_LENGTH,
  CONNECT_SECRET_PREFIX,
  connectPagePath,
} from "@skillcdn/core";
import {
  approveConnectRequest,
  type ConnectRequestRecord,
  createConnectRequest,
  type Database,
  deleteConnectRequest,
  findConnectRequestByCode,
  findConnectRequestBySecret,
  findUser,
  type RepoRecord,
  type RepoTokenRecord,
  takeApprovedConnectRequest,
  type UserRecord,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { repositoryKey } from "../mounts/mount-service.js";
import type { RepoTokens } from "./repo-tokens.js";
import { hashToken, newToken } from "./secrets.js";

// A command connecting without a token to copy (docs/specs/permissions.md, ADR-0059): it asks
// as nobody and is given a code for a person and a secret for itself; the person approves on
// the deployment's own pages, signed in; the command claims with its secret, and the repository
// token is made then, as the person, and handed over once. The database holds the hash of the
// secret and never a token.

/** How long a person has to approve. */
export const CONNECT_REQUEST_TTL_MS = 10 * 60_000;
/** How many seconds the command waits between claims. */
export const CONNECT_CLAIM_INTERVAL_SECONDS = 5;
/** How many requests a deployment holds at once: an unauthenticated route is bounded. */
export const MAX_WAITING_CONNECT_REQUESTS = 500;
const GROUP = CONNECT_CODE_LENGTH / 2;

/** A code as the alphabet spells one: two groups, from the system's randomness. */
function newCode(): string {
  const letters = Array.from(
    { length: CONNECT_CODE_LENGTH },
    () => CONNECT_CODE_ALPHABET[randomInt(CONNECT_CODE_ALPHABET.length)] ?? "A",
  ).join("");
  return `${letters.slice(0, GROUP)}-${letters.slice(GROUP)}`;
}

/** PostgreSQL's word for a row that would repeat a unique key. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505";

/** The deployment holds as many requests as it will. */
export class ConnectLimitError extends Error {
  readonly code = "connect.busy";
  readonly retryAfterSeconds = 60;
  constructor() {
    super("Too many commands are waiting to connect right now. Try again in a minute.");
    this.name = "ConnectLimitError";
  }
}

/** What the command is answered when it begins. */
export interface ConnectionStart {
  readonly code: string;
  /** The deployment's own page for the code, for the person to open. */
  readonly url: string;
  readonly secret: string;
  readonly expiresAt: Date;
  readonly intervalSeconds: number;
}

/** What a claim finds: nothing, a request still waiting, or one a person approved. */
export type Claim =
  | { readonly status: "none" }
  | { readonly status: "pending"; readonly expiresAt: Date }
  | {
      readonly status: "approved";
      readonly request: ConnectRequestRecord;
      readonly user: UserRecord;
    };

export interface ConnectionsOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly tokens: RepoTokens;
  /** The origin people use: where the page of a code is. */
  readonly origin: string;
}

export class Connections {
  readonly #options: ConnectionsOptions;

  constructor(options: ConnectionsOptions) {
    this.#options = options;
  }

  /** Begins a connection for a command that says which repository it wants and what it calls itself. */
  async begin(address: Address, agent: string): Promise<ConnectionStart> {
    const { database, clock, origin } = this.#options;
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + CONNECT_REQUEST_TTL_MS);
    const secret = newToken(CONNECT_SECRET_PREFIX);
    // A code a live request holds already fails the insert; the space is large, so another try is enough.
    for (let attempt = 0; ; attempt += 1) {
      const code = newCode();
      try {
        const made = await createConnectRequest(
          database,
          {
            code,
            secretHash: hashToken(secret),
            address: repositoryKey(address),
            agent,
            expiresAt,
            now,
          },
          MAX_WAITING_CONNECT_REQUESTS,
        );
        if (made === undefined) {
          throw new ConnectLimitError();
        }
        return {
          code: made.code,
          url: `${origin}${connectPagePath(made.code)}`,
          secret,
          expiresAt: made.expiresAt,
          intervalSeconds: CONNECT_CLAIM_INTERVAL_SECONDS,
        };
      } catch (error) {
        if (attempt < 2 && isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /** What asks to connect under a code, for the person who would approve it, or nothing. */
  look(code: string): Promise<ConnectRequestRecord | undefined> {
    const { database, clock } = this.#options;
    return findConnectRequestByCode(database, code, clock.now());
  }

  /** Records the person's yes. False when there is nothing left to approve under the code. */
  approve(
    code: string,
    user: UserRecord,
    choice: { readonly label: string; readonly expiresInDays: number | null },
  ): Promise<boolean> {
    const { database, clock } = this.#options;
    return approveConnectRequest(database, {
      code,
      userId: user.id,
      label: choice.label,
      expiresInDays: choice.expiresInDays,
      now: clock.now(),
    });
  }

  /** Ends a request: the person said no, or what was approved cannot be given. */
  end(id: string): Promise<boolean> {
    return deleteConnectRequest(this.#options.database, id);
  }

  /**
   * What a secret finds, with the request left where it is: the caller resolves the repository
   * for the person who approved before anything is spent, since the git host may not answer.
   */
  async claim(secret: string): Promise<Claim> {
    const { database, clock } = this.#options;
    const found = await findConnectRequestBySecret(database, hashToken(secret), clock.now());
    if (found === undefined) {
      return { status: "none" };
    }
    if (found.approval === undefined) {
      return { status: "pending", expiresAt: found.expiresAt };
    }
    const user = await findUser(database, found.approval.userId);
    return user === undefined ? { status: "none" } : { status: "approved", request: found, user };
  }

  /**
   * Takes an approved request out of the table, so that the token is made for it once: whoever
   * presents the secret second finds nothing. `undefined` when it is gone already.
   */
  take(secret: string): Promise<ConnectRequestRecord | undefined> {
    const { database, clock } = this.#options;
    return takeApprovedConnectRequest(database, hashToken(secret), clock.now());
  }

  /**
   * Makes the token an approved request asked for, as the person who approved it, for the
   * repository the caller resolved for them a moment ago. `undefined` when they hold as many as
   * one may.
   */
  async issue(
    request: ConnectRequestRecord,
    user: UserRecord,
    repo: RepoRecord,
    address: Address,
  ): Promise<{ readonly token: string; readonly record: RepoTokenRecord } | undefined> {
    const { approval } = request;
    if (approval === undefined) {
      throw new Error("an approved request has an approval");
    }
    const made = await this.#options.tokens.create(user, repo, address, {
      label: approval.label,
      expiresInDays: approval.expiresInDays,
    });
    if (made !== undefined) {
      this.#options.logger.info(
        { user: user.id, token: made.record.id, agent: request.agent },
        "repository token made for a command that connected",
      );
    }
    return made;
  }
}
