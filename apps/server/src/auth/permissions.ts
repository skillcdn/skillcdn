import { type Clock, GitHostError, type GitHostLogin, type RepoCoordinates } from "@skillcdn/core";
import {
  type Database,
  findReadableRepo,
  type RepoAliasRecord,
  type RepoRecord,
  saveRepoPermission,
  type UserRecord,
} from "@skillcdn/db";
import type { RepoPermissions } from "../mounts/mount-service.js";
import type { UserCredentials } from "./credentials.js";

export interface PermissionsOptions {
  readonly database: Database;
  readonly login: GitHostLogin;
  readonly credentials: UserCredentials;
  readonly clock: Clock;
  /** How long the host's answer is believed before it is asked again. */
  readonly ttlMs: number;
}

/** Names a person asked about that the host did not show them, remembered for a moment. */
const MAX_REMEMBERED_MISSES = 10_000;

/**
 * Whether a person can see a repository that is not public (docs/specs/permissions.md). The git
 * host owns the answer: it is asked with the person's own credential, and only its yes or no is
 * kept, for a short while. Without an answer there is no access: a host that cannot be asked
 * fails the request instead of letting an old answer stand.
 *
 * A yes is kept in the database, where every replica reads it. That a name was nothing, to
 * everyone and to the person, is kept for that person, in this process, and nowhere else.
 * Nothing that one person's question leaves behind is there for another's, so a stranger's
 * question about a repository in use meets what a question about a name that is nothing meets.
 */
export class Permissions implements RepoPermissions {
  readonly #options: PermissionsOptions;
  /** Collapses the questions that arrive together into one. */
  readonly #asking = new Map<string, Promise<string | undefined>>();
  /** By person and name: until when "nothing by that name" is believed without asking again. */
  readonly #misses = new Map<string, number>();

  constructor(options: PermissionsOptions) {
    this.#options = options;
  }

  missed(user: UserRecord, coordinates: RepoCoordinates): boolean {
    const until = this.#misses.get(this.#key(user, coordinates)) ?? 0;
    return until > this.#options.clock.now().getTime();
  }

  noteMiss(user: UserRecord, coordinates: RepoCoordinates): void {
    const { clock, ttlMs } = this.#options;
    // Anyone who signed in can ask about any name, and each question costs requests to the
    // host: a name that was nothing is not asked about again until an answer would be.
    const key = this.#key(user, coordinates);
    this.#misses.delete(key);
    this.#misses.set(key, clock.now().getTime() + ttlMs);
    if (this.#misses.size > MAX_REMEMBERED_MISSES) {
      const oldest = this.#misses.keys().next().value;
      if (oldest !== undefined) {
        this.#misses.delete(oldest);
      }
    }
  }

  async readable(
    user: UserRecord,
    coordinates: RepoCoordinates,
  ): Promise<{ readonly repo: RepoAliasRecord; readonly fresh: boolean } | undefined> {
    const { database, clock, ttlMs } = this.#options;
    const known = await findReadableRepo(database, {
      userId: user.id,
      alias: { host: coordinates.host, owner: coordinates.owner, repo: coordinates.repo },
    });
    if (known === undefined) {
      return undefined;
    }
    const age = clock.now().getTime() - known.checkedAt.getTime();
    // An answer from the future was written by a process whose clock runs ahead: it is not
    // believed longer for that.
    return { repo: known.repo, fresh: age >= 0 && age < ttlMs };
  }

  visibleRepository(user: UserRecord, coordinates: RepoCoordinates): Promise<string | undefined> {
    return this.#ask(user, coordinates);
  }

  async remember(user: UserRecord, repo: RepoRecord, allowed: boolean): Promise<void> {
    const { database, clock } = this.#options;
    await saveRepoPermission(database, { userId: user.id, repoId: repo.id }, allowed, clock.now());
  }

  #key(user: UserRecord, coordinates: RepoCoordinates): string {
    return `${user.id} ${coordinates.host}/${coordinates.owner}/${coordinates.repo}`;
  }

  /** The host's id of the repository the name means to the person, when they can see one. */
  #ask(user: UserRecord, coordinates: RepoCoordinates): Promise<string | undefined> {
    const key = this.#key(user, coordinates);
    let asking = this.#asking.get(key);
    if (asking === undefined) {
      asking = this.#askHost(user, coordinates).finally(() => {
        this.#asking.delete(key);
      });
      this.#asking.set(key, asking);
    }
    return asking;
  }

  async #askHost(user: UserRecord, coordinates: RepoCoordinates): Promise<string | undefined> {
    const { login, credentials } = this.#options;
    const token = await credentials.accessToken(user.id);
    try {
      return await login.visibleRepository(token, coordinates);
    } catch (error) {
      if (error instanceof GitHostError && error.kind === "unauthorized") {
        return credentials.refused(user.id);
      }
      throw error;
    }
  }
}
