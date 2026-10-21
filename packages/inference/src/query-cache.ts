import type { Embedder } from "@skillcdn/core";

export interface QueryCacheOptions {
  /** How many queries are remembered. */
  readonly size?: number | undefined;
  /** How long a query's vector is remembered. */
  readonly ttlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

const DEFAULT_QUERY_CACHE_SIZE = 500;
/** The pages of one search are turned within minutes; a query asked again later is embedded again. */
const DEFAULT_QUERY_CACHE_TTL_MS = 10 * 60_000;

/**
 * The embedder with the vectors of recent queries remembered in this process, so that the next
 * page of a search, or the same question asked again, does not call the server: a query's vector
 * depends on the model and the instruction alone, which are this embedder's. Documents pass
 * through untouched. Bounded, and an optimization only: a miss is a call, as before.
 */
export function withQueryCache(embedder: Embedder, options: QueryCacheOptions = {}): Embedder {
  const size = options.size ?? DEFAULT_QUERY_CACHE_SIZE;
  const ttlMs = options.ttlMs ?? DEFAULT_QUERY_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { readonly vector: Float32Array; readonly until: number }>();
  return {
    model: embedder.model,
    dimensions: embedder.dimensions,
    maxTexts: embedder.maxTexts,
    maxTextChars: embedder.maxTextChars,
    maxBatchChars: embedder.maxBatchChars,
    async embed(texts, as) {
      const query = as === "query" && texts.length === 1 ? texts[0] : undefined;
      if (query === undefined) {
        return embedder.embed(texts, as);
      }
      const known = cache.get(query);
      if (known !== undefined && known.until > now()) {
        // Touched: the most recently asked stays longest.
        cache.delete(query);
        cache.set(query, known);
        return { vectors: [known.vector], tokens: 0 };
      }
      const embedded = await embedder.embed(texts, as);
      const vector = embedded.vectors[0];
      if (vector !== undefined) {
        cache.delete(query);
        cache.set(query, { vector, until: now() + ttlMs });
        if (cache.size > size) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) {
            cache.delete(oldest);
          }
        }
      }
      return embedded;
    },
  };
}
