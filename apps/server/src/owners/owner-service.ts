import {
  accountAvatarUrl,
  accountPageUrl,
  type Clock,
  DomainError,
  formatAddress,
  type GitHostDirectory,
  GitHostError,
  type HostProfile,
  type HostRepositoryPage,
  type OwnerPath,
  parseAddress,
  parseRepoPath,
  REST_FEATURED_SKILL_NAMES,
  type RepoCoordinates,
  type RestOwner,
  type RestRepositoryCard,
  rawFileUrl,
} from "@skillcdn/core";
import { type Database, type IndexedRepository, listIndexedRepositories } from "@skillcdn/db";
import { repositoryKey } from "../mounts/mount-service.js";
import type { OperatorImages } from "../operator/images.js";
import type { OperatorLists } from "../operator/lists.js";

/** No such account at the git host, as far as the public can see. */
export class OwnerNotFoundError extends DomainError {
  constructor(options?: { readonly cause?: unknown }) {
    super("owner.not_found", "the account was not found", options);
  }
}

export interface OwnerServiceOptions {
  readonly database: Database;
  readonly directory: GitHostDirectory;
  readonly lists: OperatorLists;
  readonly images: OperatorImages;
  readonly clock: Clock;
  /** How long what the host said about an account is believed. */
  readonly ttlMs: number;
  /**
   * Whether a name is a public repository right now, for a repository the host's list did not
   * just name: `false` when it is not, and when that could not be asked.
   */
  readonly isPublic: (coordinates: RepoCoordinates) => Promise<boolean>;
}

/** The size of the pictures the pages ask the host for: 80 CSS pixels on a 2x screen. */
const AVATAR_SIZE = 160;
/** How many indexed repositories lead the page of an account. */
const MAX_INDEXED = 60;
const MAX_REMEMBERED = 500;

interface Remembered<Value> {
  readonly until: number;
  readonly value: Promise<Value>;
}

/**
 * The page of an account (docs/adr/0037): who the account is and which public repositories it
 * has, as the git host tells everyone, with the repositories this deployment has indexed and
 * found skills in first, each only while the host still shows it to everyone. Listing reads the
 * index and never adds to it: a repository is indexed when somebody opens it, not because its
 * owner's page was looked at.
 */
export class OwnerService {
  readonly #options: OwnerServiceOptions;
  /** What the host said, kept for a while: every visitor is told the same, and asking costs quota. */
  readonly #profiles = new Map<string, Remembered<HostProfile | undefined>>();
  readonly #listings = new Map<string, Remembered<HostRepositoryPage>>();

  constructor(options: OwnerServiceOptions) {
    this.#options = options;
  }

  #remember<Value>(
    kept: Map<string, Remembered<Value>>,
    key: string,
    load: () => Promise<Value>,
  ): Promise<Value> {
    const now = this.#options.clock.now().getTime();
    const known = kept.get(key);
    if (known !== undefined && known.until > now) {
      return known.value;
    }
    const value = load();
    // A failure is not an answer: the next visitor asks again.
    value.catch(() => {
      if (kept.get(key)?.value === value) {
        kept.delete(key);
      }
    });
    kept.delete(key);
    kept.set(key, { until: now + this.#options.ttlMs, value });
    if (kept.size > MAX_REMEMBERED) {
      const oldest = kept.keys().next().value;
      if (oldest !== undefined) {
        kept.delete(oldest);
      }
    }
    return value;
  }

  /** The account, or `undefined` when the host shows none by that name. */
  #profile(owner: OwnerPath): Promise<HostProfile | undefined> {
    return this.#remember(this.#profiles, `${owner.host}/${owner.owner}`, async () => {
      try {
        return await this.#options.directory.getProfile(owner.host, owner.owner);
      } catch (error) {
        if (error instanceof GitHostError && error.kind === "not_found") {
          return undefined;
        }
        throw error;
      }
    });
  }

  #listing(owner: OwnerPath, page: number): Promise<HostRepositoryPage> {
    return this.#remember(this.#listings, `${owner.host}/${owner.owner} ${page}`, () =>
      this.#options.directory.listPublicRepositories(owner.host, owner.owner, page),
    );
  }

  /**
   * The card of an indexed repository, or nothing when it may not be shown. `listed` holds the
   * host's ids of the repositories its public list just named.
   */
  async #card(
    profile: HostProfile,
    owner: OwnerPath,
    row: IndexedRepository,
    listed: ReadonlySet<string>,
  ) {
    const { lists, images, isPublic } = this.#options;
    const parsed = parseAddress(`/${owner.host}/${row.owner}/${row.name}`);
    if (!parsed.ok) {
      return undefined;
    }
    const address = parsed.value;
    const key = repositoryKey(address);
    // A blocked repository does not exist for callers, so no list may name it.
    if (await lists.isBlocked(key)) {
      return undefined;
    }
    // The index remembers a repository as it was when it was read. It is shown only while the
    // host still shows it to everyone: its public list names it, or the host confirms the name.
    // One that went private since is nobody's to see here, and what cannot be confirmed is not
    // shown.
    if (
      !listed.has(row.hostRepoId) &&
      !(await isPublic({ host: address.host, owner: address.owner, repo: address.repo }))
    ) {
      return undefined;
    }
    const declared = row.manifest?.image;
    const declaredPath = declared === undefined ? undefined : parseRepoPath(declared);
    const card: RestRepositoryCard = {
      address: formatAddress(address),
      repository: {
        host: owner.host,
        owner: row.owner,
        name: row.name,
        defaultBranch: row.defaultBranch,
        description: row.description ?? null,
        avatar: accountAvatarUrl(owner.host, profile.hostAccountId, AVATAR_SIZE),
        visibility: "public",
      },
      manifest:
        row.manifest === undefined
          ? null
          : {
              name: row.manifest.name ?? null,
              description: row.manifest.description,
              translations: Object.fromEntries(
                Object.entries(row.manifest.translations).map(([tag, entry]) => [
                  tag,
                  { name: entry.name ?? null, description: entry.description ?? null },
                ]),
              ),
            },
      verified: await lists.isVerified(key),
      // The operator's picture, else the one the manifest declares, as on the page of the address.
      image:
        (await images.imageFor(address)) ??
        (declared === undefined
          ? null
          : /^https:\/\//i.test(declared)
            ? declared
            : declaredPath?.ok === true
              ? rawFileUrl(
                  { host: owner.host, owner: row.owner, name: row.name },
                  row.commit,
                  declaredPath.value,
                )
              : null),
      status: "ready",
      skillCount: row.skillCount,
      skills: [...row.skills],
    };
    return card;
  }

  /**
   * One page of the page of an account. Rejects with {@link OwnerNotFoundError} for an account
   * the host does not show, and with a `GitHostError` when the host cannot be asked.
   */
  async page(owner: OwnerPath, page: number): Promise<RestOwner> {
    const { database, lists } = this.#options;
    const profile = await this.#profile(owner);
    if (profile === undefined) {
      throw new OwnerNotFoundError();
    }
    const [indexed, listing] = await Promise.all([
      listIndexedRepositories(
        database,
        { host: owner.host, hostAccountId: profile.hostAccountId },
        { repositories: MAX_INDEXED, skillNames: REST_FEATURED_SKILL_NAMES },
      ),
      this.#listing(owner, page),
    ]);
    // What is indexed leads the first page; the pages after it only continue the host's list.
    const listed = new Set(listing.repositories.map((repository) => repository.hostRepoId));
    const cards =
      page === 1
        ? (
            await Promise.all(indexed.map((row) => this.#card(profile, owner, row, listed)))
          ).flatMap((card) => (card === undefined ? [] : [card]))
        : [];
    // Whatever the index knows is left out of the host's list on every page: it led the first
    // page, or it is not to be shown at all.
    const shown = new Set(indexed.map((row) => row.hostRepoId));
    const repositories: RestOwner["repositories"][number][] = [];
    for (const listed of listing.repositories) {
      const parsed = parseAddress(`/${owner.host}/${profile.login}/${listed.name}`);
      if (
        !parsed.ok ||
        shown.has(listed.hostRepoId) ||
        (await lists.isBlocked(repositoryKey(parsed.value)))
      ) {
        continue;
      }
      repositories.push({
        address: formatAddress(parsed.value),
        name: listed.name,
        description: listed.description ?? null,
        fork: listed.fork,
        archived: listed.archived,
        stars: listed.stars,
        pushedAt: listed.pushedAt ?? null,
      });
    }
    return {
      owner: {
        host: owner.host,
        login: profile.login,
        name: profile.name ?? null,
        kind: profile.kind,
        avatar: accountAvatarUrl(owner.host, profile.hostAccountId, AVATAR_SIZE * 2),
        bio: profile.bio ?? null,
        url: accountPageUrl(owner.host, profile.login),
        publicRepositories: profile.publicRepositories,
      },
      indexed: cards,
      repositories,
      nextPage: listing.hasMore ? page + 1 : null,
    };
  }
}
