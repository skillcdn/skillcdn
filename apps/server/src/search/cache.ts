import { type Clock, normalizeSearchTerm } from "@skillcdn/core";
import type { HubSearch } from "./hub.js";

// What stands between the search across every pack and whoever asks for it (ADR-0075): the
// answer to a question is kept for a while and given to the next who asks the same, a question
// already being answered is answered once for everyone waiting on it, and only so many
// questions are answered at once, the rest told to come back. A search reads every pack there
// is, so a burst of questions is the one thing that can take a deployment down from its pages;
// a cache in front of the deployment keeps the pages themselves, and this keeps the database.

export interface SearchCacheOptions {
  /** How long an answer is kept, in milliseconds; 0 keeps nothing. */
  readonly ttlMs: number;
  /** How many answers are kept at most, the least recently asked out first; 0 keeps nothing. */
  readonly entries: number;
  /** How many searches run at once in this process; past that, a search is refused. */
  readonly concurrency: number;
  readonly clock: Clock;
}

/** Thrown when more searches run at once than the deployment allows: ask again in a moment. */
export class SearchBusyError extends Error {
  readonly code = "search.busy";
  /** How long to wait before asking again, in seconds. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 2) {
    super("Too many searches are running. Try again in a moment.");
    this.name = "SearchBusyError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface Kept<T> {
  readonly until: number;
  readonly value: T;
}

/**
 * A search cached, coalesced and bounded. The same question is the same words, however they
 * were spaced, at the same limit. Only a search that answered is kept; one that failed is asked
 * again by the next who asks. `packs()` goes through as it is: the search keeps its own count.
 */
export function withSearchCache(hub: HubSearch, options: SearchCacheOptions): HubSearch {
  const { ttlMs, entries, concurrency, clock } = options;
  type Answer = Awaited<ReturnType<HubSearch["search"]>>;
  const kept = new Map<string, Kept<Answer>>();
  const pending = new Map<string, Promise<Answer>>();
  let active = 0;

  const keyOf = (query: string, limit: number): string =>
    `${normalizeSearchTerm(query)}\u0000${limit}`;

  const remember = (key: string, value: Answer): void => {
    if (ttlMs <= 0 || entries <= 0) {
      return;
    }
    kept.delete(key);
    kept.set(key, { until: clock.now().getTime() + ttlMs, value });
    while (kept.size > entries) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      kept.delete(oldest);
    }
  };

  return {
    packs: () => hub.packs(),
    async search(query, limit) {
      const key = keyOf(query, limit);
      const found = kept.get(key);
      if (found !== undefined) {
        if (found.until > clock.now().getTime()) {
          // Asked again lately: it goes to the end, so that it is the last to be let go of.
          kept.delete(key);
          kept.set(key, found);
          return found.value;
        }
        kept.delete(key);
      }
      const running = pending.get(key);
      if (running !== undefined) {
        return running;
      }
      if (active >= concurrency) {
        throw new SearchBusyError();
      }
      active += 1;
      const answer = hub.search(query, limit).then(
        (value) => {
          remember(key, value);
          return value;
        },
        (error: unknown) => {
          throw error;
        },
      );
      pending.set(key, answer);
      try {
        return await answer;
      } finally {
        active -= 1;
        pending.delete(key);
      }
    },
  };
}
