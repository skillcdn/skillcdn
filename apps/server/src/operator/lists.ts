import {
  type Clock,
  formatAddress,
  type GitHostAddress,
  isGitHostAddress,
  parseAddress,
  REFERENCE_REPOSITORY_ADDRESS,
} from "@skillcdn/core";
import {
  addOperatorRepository,
  type Database,
  listOperatorRepositories,
  type OperatorListKind,
  type OperatorRepository,
  removeOperatorRepository,
} from "@skillcdn/db";
import { repositoryKey } from "../mounts/mount-service.js";

/** How long a process trusts what it read of the lists; a change made elsewhere shows within it. */
const LISTS_TTL_MS = 30_000;

/**
 * What a fresh deployment features until the operator features something: the reference
 * repository of this project (ADR-0028). It leaves the list the moment the operator adds an entry.
 */
const DEFAULT_FEATURED: readonly GitHostAddress[] = (() => {
  const parsed = parseAddress(REFERENCE_REPOSITORY_ADDRESS);
  return parsed.ok && isGitHostAddress(parsed.value) ? [parsed.value] : [];
})();

/** An entry of a list as an address of a git host, which is all the lists hold; nothing for anything else. */
function listedAddress(text: string): GitHostAddress | undefined {
  const parsed = parseAddress(text);
  return parsed.ok && isGitHostAddress(parsed.value) ? parsed.value : undefined;
}

export class OperatorListError extends Error {
  readonly code = "operator.invalid_address";
}

/**
 * The operator's lists (ADR-0026), read from the database and kept for a short while: the
 * repositories it vouches for, the addresses it features, and the repositories it does not
 * serve. Writes go through here too, so that this process sees them at once.
 */
export class OperatorLists {
  readonly #database: Database;
  readonly #clock: Clock;
  #loaded:
    | { readonly until: number; readonly entries: Promise<readonly OperatorRepository[]> }
    | undefined;

  constructor(options: { readonly database: Database; readonly clock: Clock }) {
    this.#database = options.database;
    this.#clock = options.clock;
  }

  /** The address an entry of `kind` is stored under, or why the text is not one. */
  static addressOf(kind: OperatorListKind, text: string): GitHostAddress {
    const parsed = parseAddress(text.startsWith("/") ? text : `/${text}`);
    if (!parsed.ok) {
      throw new OperatorListError(`not an address such as /gh/owner/repo: ${parsed.error.message}`);
    }
    // The lists name repositories of a git host; a pack served from a machine is none (ADR-0053).
    if (!isGitHostAddress(parsed.value)) {
      throw new OperatorListError("not an address such as /gh/owner/repo: not a git host");
    }
    if (kind !== "featured" && (parsed.value.ref !== undefined || parsed.value.path.length > 0)) {
      throw new OperatorListError(
        `a ${kind} repository is written as /gh/owner/repo, without a ref or a path`,
      );
    }
    return parsed.value;
  }

  async all(kind?: OperatorListKind): Promise<readonly OperatorRepository[]> {
    const entries = await this.#entries();
    return kind === undefined ? entries : entries.filter((entry) => entry.kind === kind);
  }

  async isVerified(key: string): Promise<boolean> {
    return (await this.#keys("verified")).has(key);
  }

  async isBlocked(key: string): Promise<boolean> {
    return (await this.#keys("blocked")).has(key);
  }

  /** The featured addresses, in the order they were added; the default while there are none. */
  async featured(): Promise<readonly GitHostAddress[]> {
    const listed = (await this.all("featured")).flatMap((entry) => {
      const address = listedAddress(entry.address);
      return address === undefined ? [] : [address];
    });
    return listed.length > 0 ? listed : DEFAULT_FEATURED;
  }

  /**
   * What the operator points the public at: the featured addresses (the default while there are
   * none) and the vouched-for repositories, without duplicates and without anything blocked. A
   * blocked repository does not exist for callers, so no list may name it.
   */
  async listed(): Promise<readonly GitHostAddress[]> {
    const blocked = await this.#keys("blocked");
    const entries = await this.#entries();
    const candidates: GitHostAddress[] = entries.some((entry) => entry.kind === "featured")
      ? []
      : [...DEFAULT_FEATURED];
    for (const entry of entries) {
      const address = entry.kind === "blocked" ? undefined : listedAddress(entry.address);
      if (address !== undefined) {
        candidates.push(address);
      }
    }
    const seen = new Set<string>();
    const addresses: GitHostAddress[] = [];
    for (const address of candidates) {
      const written = formatAddress(address);
      if (blocked.has(repositoryKey(address)) || seen.has(written)) {
        continue;
      }
      seen.add(written);
      addresses.push(address);
    }
    return addresses;
  }

  async add(kind: OperatorListKind, text: string): Promise<string> {
    const address = formatAddress(OperatorLists.addressOf(kind, text));
    await addOperatorRepository(this.#database, kind, address);
    this.#loaded = undefined;
    return address;
  }

  async remove(kind: OperatorListKind, text: string): Promise<boolean> {
    const address = formatAddress(OperatorLists.addressOf(kind, text));
    const removed = await removeOperatorRepository(this.#database, kind, address);
    this.#loaded = undefined;
    return removed;
  }

  /** Forget what was read, so that the next question asks the database. */
  invalidate(): void {
    this.#loaded = undefined;
  }

  async #keys(kind: OperatorListKind): Promise<ReadonlySet<string>> {
    return new Set(
      (await this.all(kind)).flatMap((entry) => {
        const parsed = parseAddress(entry.address);
        return parsed.ok ? [repositoryKey(parsed.value)] : [];
      }),
    );
  }

  #entries(): Promise<readonly OperatorRepository[]> {
    const now = this.#clock.now().getTime();
    if (this.#loaded === undefined || this.#loaded.until <= now) {
      const entries = listOperatorRepositories(this.#database);
      this.#loaded = { until: now + LISTS_TTL_MS, entries };
      entries.catch(() => {
        this.#loaded = undefined;
      });
    }
    return this.#loaded.entries;
  }
}
