import type { HubResult } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { SearchBusyError, withSearchCache } from "./cache.js";
import type { HubSearch } from "./hub.js";

// The search across every pack behind its cache (ADR-0075): one answer per question for a
// while, one search per question in flight, and only so many searches at once.

const answer = (query: string): HubResult => ({ query, packs: 1, items: [] });

/** A search that answers when told to, counting what it was asked. */
function slowHub() {
  const asked: string[] = [];
  const waiting: (() => void)[] = [];
  const hub: HubSearch = {
    packs: async () => 1,
    search: (query) =>
      new Promise((resolve) => {
        asked.push(query);
        waiting.push(() => resolve(answer(query)));
      }),
  };
  const release = (): void => {
    for (const done of waiting.splice(0)) {
      done();
    }
  };
  return { hub, asked, release };
}

describe("withSearchCache", () => {
  it("answers the same question from what it kept, for as long as that is kept", async () => {
    let now = 0;
    const { hub, asked, release } = slowHub();
    const cached = withSearchCache(hub, {
      ttlMs: 1000,
      entries: 10,
      concurrency: 4,
      clock: { now: () => new Date(now) },
    });
    const first = cached.search("card  news ", 10);
    release();
    expect(await first).toEqual(answer("card  news "));
    // The same words, however spaced, at the same limit, are the same question; the limit is not.
    expect(await cached.search("card news", 10)).toEqual(answer("card  news "));
    expect(asked).toEqual(["card  news "]);
    const other = cached.search("card news", 5);
    release();
    await other;
    expect(asked).toHaveLength(2);
    now = 1001;
    const again = cached.search("card news", 10);
    release();
    expect(await again).toEqual(answer("card news"));
    expect(asked).toHaveLength(3);
  });

  it("keeps nothing of an answer that stands in for a failure", async () => {
    // What a search answers when its words ran out of their time (ADR-0091): the meaning's alone.
    const asked: string[] = [];
    let whole = false;
    const hub: HubSearch = {
      packs: async () => 1,
      search: async (query) => {
        asked.push(query);
        return {
          ...answer(query),
          ranking: { meaning: true, reranked: false, ...(whole ? {} : { words: false }) },
        };
      },
    };
    const cached = withSearchCache(hub, {
      ttlMs: 1000,
      entries: 10,
      concurrency: 4,
      clock: { now: () => new Date(0) },
    });
    expect((await cached.search("card news", 10)).ranking?.words).toBe(false);
    // The next who asks is asked for again, and what answers in full is kept.
    whole = true;
    expect((await cached.search("card news", 10)).ranking?.words).toBeUndefined();
    await cached.search("card news", 10);
    expect(asked).toHaveLength(2);
  });

  it("keeps nothing of an answer its meaning did not reach, and keeps one that asked for none", async () => {
    // The comparison rests, or the embedder is away: the words answered alone this time
    // (ADR-0096). Kept, that answer would be given again after the meaning is back.
    const asked: string[] = [];
    let ranking: HubResult["ranking"] = { meaning: false, reranked: false };
    const hub: HubSearch = {
      packs: async () => 1,
      search: async (query) => {
        asked.push(query);
        return { ...answer(query), ...(ranking === undefined ? {} : { ranking }) };
      },
    };
    const cached = withSearchCache(hub, {
      ttlMs: 1000,
      entries: 10,
      concurrency: 4,
      clock: { now: () => new Date(0) },
    });
    expect((await cached.search("card news", 10)).ranking?.meaning).toBe(false);
    ranking = { meaning: true, reranked: false };
    expect((await cached.search("card news", 10)).ranking?.meaning).toBe(true);
    await cached.search("card news", 10);
    expect(asked).toHaveLength(2);
    // A query of identifiers is ranked by its words on purpose, and a deployment without a
    // model says nothing of a ranking: both are answers in full.
    ranking = { meaning: false, reranked: false, identifiers: true };
    await cached.search("4.2.6", 10);
    await cached.search("4.2.6", 10);
    ranking = undefined;
    await cached.search("decks", 10);
    await cached.search("decks", 10);
    expect(asked).toEqual(["card news", "card news", "4.2.6", "decks"]);
  });

  it("asks once for everyone waiting on the same question", async () => {
    const { hub, asked, release } = slowHub();
    const cached = withSearchCache(hub, {
      ttlMs: 0,
      entries: 0,
      concurrency: 1,
      clock: { now: () => new Date(0) },
    });
    const one = cached.search("decks", 10);
    const two = cached.search("decks", 10);
    release();
    expect(await Promise.all([one, two])).toEqual([answer("decks"), answer("decks")]);
    expect(asked).toEqual(["decks"]);
    // Nothing is kept with a TTL of 0: the next is asked again.
    const three = cached.search("decks", 10);
    release();
    await three;
    expect(asked).toHaveLength(2);
  });

  it("refuses a search past the concurrency, and takes the next once one has answered", async () => {
    const { hub, release } = slowHub();
    const cached = withSearchCache(hub, {
      ttlMs: 1000,
      entries: 10,
      concurrency: 2,
      clock: { now: () => new Date(0) },
    });
    const first = cached.search("a", 10);
    const second = cached.search("b", 10);
    await expect(cached.search("c", 10)).rejects.toBeInstanceOf(SearchBusyError);
    // A question already in flight is still answered: it costs no search of its own.
    const again = cached.search("a", 10);
    release();
    await Promise.all([first, second, again]);
    const third = cached.search("c", 10);
    release();
    expect(await third).toEqual(answer("c"));
  });

  it("keeps the least recently asked answers, up to the bound", async () => {
    const { hub, asked, release } = slowHub();
    const cached = withSearchCache(hub, {
      ttlMs: 1000,
      entries: 2,
      concurrency: 4,
      clock: { now: () => new Date(0) },
    });
    for (const query of ["a", "b"]) {
      const result = cached.search(query, 10);
      release();
      await result;
    }
    await cached.search("a", 10);
    const c = cached.search("c", 10);
    release();
    await c;
    // "b" was the least recently asked: gone; "a" and "c" stay.
    await cached.search("a", 10);
    await cached.search("c", 10);
    const b = cached.search("b", 10);
    release();
    await b;
    expect(asked).toEqual(["a", "b", "c", "b"]);
  });

  it("keeps nothing of a search that failed", async () => {
    let fail = true;
    const hub: HubSearch = {
      packs: async () => 1,
      search: async (query) => {
        if (fail) {
          throw new Error("timeout");
        }
        return answer(query);
      },
    };
    const cached = withSearchCache(hub, {
      ttlMs: 1000,
      entries: 10,
      concurrency: 4,
      clock: { now: () => new Date(0) },
    });
    await expect(cached.search("x", 10)).rejects.toThrow("timeout");
    fail = false;
    expect(await cached.search("x", 10)).toEqual(answer("x"));
    expect(await cached.packs()).toBe(1);
  });
});
