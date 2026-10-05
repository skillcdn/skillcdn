import type { Clock, GitHostEvent, GitHostKey, HostEventScope } from "@skillcdn/core";
import {
  type Database,
  deleteRepoPermissionsOf,
  deleteUserCredentials,
  expireRepoAliases,
  expireRepoRefs,
  findRepoByHostId,
  findUserByHostAccount,
  forgetUserAccess,
  type KnownRepo,
  listReposOfHostAccount,
  markRepositoryNotPublic,
  purgeRepositoryIndex,
} from "@skillcdn/db";

export interface HostEventsOptions {
  readonly database: Database;
  readonly clock: Clock;
  /** The git host the events are about. */
  readonly host: GitHostKey;
  /** How long what the host said about a repository name is believed, as the mounts have it. */
  readonly repoTtlMs: number;
  /** How long a moving ref is believed, as the mounts have it. */
  readonly refTtlMs: number;
}

/**
 * What the git host says happened, applied to what the deployment remembers
 * (docs/specs/permissions.md, ADR-0038). An event ends things and establishes nothing: answers
 * about who can see a repository are forgotten, facts about a name and its refs are made due
 * for asking again, and what was read of a repository the app was taken off is removed. The
 * host is asked again by the next request that needs to know, so an event that comes twice or
 * late costs a question and nothing else. Everything ended is in the database, where every
 * process reads it: the process that received the event needs to tell no other.
 */
export class HostEvents {
  readonly #options: HostEventsOptions;

  constructor(options: HostEventsOptions) {
    this.#options = options;
  }

  /**
   * Applies one event. Answers with how many repositories or people of this deployment it
   * concerned: none for an event about something that was never seen here.
   */
  async apply(event: GitHostEvent): Promise<number> {
    const { database, clock, host } = this.#options;
    switch (event.kind) {
      case "refs_changed": {
        const repo = await findRepoByHostId(database, { host, hostRepoId: event.hostRepoId });
        if (repo === undefined) {
          return 0;
        }
        await expireRepoRefs(database, repo, this.#due(this.#options.refTtlMs));
        return 1;
      }
      case "repository_changed": {
        const repo = await findRepoByHostId(database, { host, hostRepoId: event.hostRepoId });
        if (repo === undefined) {
          return 0;
        }
        // Closing first: from here on nothing serves it as public, whatever else fails below.
        if (event.closed !== undefined) {
          await markRepositoryNotPublic(database, repo, clock.now());
        }
        await expireRepoAliases(database, repo, this.#due(this.#options.repoTtlMs));
        await expireRepoRefs(database, repo, this.#due(this.#options.refTtlMs));
        await deleteRepoPermissionsOf(database, [repo.repoId]);
        if (event.closed === "gone") {
          await purgeRepositoryIndex(database, repo.repoId);
        }
        return 1;
      }
      case "access_changed": {
        const repos = await this.#reposOf(event.scope);
        await deleteRepoPermissionsOf(
          database,
          repos.map((repo) => repo.repoId),
        );
        return repos.length;
      }
      case "installation_removed": {
        const repos = await this.#reposOf(event.scope);
        await deleteRepoPermissionsOf(
          database,
          repos.map((repo) => repo.repoId),
        );
        // What was read through the installation is not kept once the owner took the app off.
        // What is public was read as anyone reads it, and stays.
        for (const repo of repos) {
          if (repo.visibility !== "public") {
            await purgeRepositoryIndex(database, repo.repoId);
          }
        }
        return repos.length;
      }
      case "authorization_revoked": {
        const user = await findUserByHostAccount(database, {
          host,
          hostAccountId: event.hostAccountId,
        });
        if (user === undefined) {
          return 0;
        }
        // What losing the credential means, without waiting for the host to refuse it.
        await deleteUserCredentials(database, user.id);
        await forgetUserAccess(database, user.id);
        return 1;
      }
    }
  }

  /**
   * The instant from which a fact believed for `ttlMs` is due for asking again. A fact is made
   * due, not forgotten: while the host cannot be asked, what was known still stands for as long
   * as it would have without the event.
   */
  #due(ttlMs: number): Date {
    return new Date(this.#options.clock.now().getTime() - ttlMs);
  }

  async #reposOf(scope: HostEventScope): Promise<KnownRepo[]> {
    const { database, host } = this.#options;
    if ("hostAccountId" in scope) {
      return listReposOfHostAccount(database, { host, hostAccountId: scope.hostAccountId });
    }
    const repos: KnownRepo[] = [];
    for (const hostRepoId of scope.hostRepoIds) {
      const repo = await findRepoByHostId(database, { host, hostRepoId });
      if (repo !== undefined) {
        repos.push(repo);
      }
    }
    return repos;
  }
}
