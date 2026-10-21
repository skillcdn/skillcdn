import { type Embedder, type Reranker, SECTIONING_VERSION } from "@skillcdn/core";
import type { VectorKey } from "@skillcdn/db";
import type { EmbeddingsConfig, RerankerConfig } from "../config/config.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";
import { createEmbeddingsApi } from "./embeddings-api.js";
import type { FetchLike } from "./inference.js";
import { createRerankApi } from "./rerank-api.js";

// The servers of the search by meaning as the configuration names them (ADR-0064, ADR-0065),
// wired to their adapters the same way in every role that uses them.

const USER_AGENT = `${SERVER_NAME}/${SERVER_VERSION}`;
const platformFetch: FetchLike = (input, init) => fetch(input, init);

export function createEmbedderOf(
  config: EmbeddingsConfig,
  fetchLike: FetchLike = platformFetch,
): Embedder {
  return createEmbeddingsApi({
    url: config.url,
    model: config.model,
    dimensions: config.dimensions,
    queryInstruction: config.queryInstruction,
    key: config.key,
    userAgent: USER_AGENT,
    fetch: fetchLike,
    timeoutMs: config.timeoutMs,
    queryTimeoutMs: config.queryTimeoutMs,
    concurrency: config.concurrency,
    maxTexts: config.batchTexts,
    maxBatchChars: config.batchChars,
    maxTextChars: config.textChars,
  });
}

export function createRerankerOf(
  config: RerankerConfig,
  fetchLike: FetchLike = platformFetch,
): Reranker {
  return createRerankApi({
    url: config.url,
    model: config.model,
    key: config.key,
    userAgent: USER_AGENT,
    fetch: fetchLike,
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
  });
}

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

/**
 * What the vectors an embedder makes are keyed by (ADR-0064): its model and dimensions, and the
 * version of the rules that cut documents into sections, which this build embeds under.
 */
export function vectorKeyOf(embedder: Pick<Embedder, "model" | "dimensions">): VectorKey {
  return {
    model: embedder.model,
    dimensions: embedder.dimensions,
    sectioningVersion: SECTIONING_VERSION,
  };
}
