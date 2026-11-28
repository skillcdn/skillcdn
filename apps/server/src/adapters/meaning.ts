import { type Embedder, type Reranker, SECTIONING_VERSION } from "@skillcdn/core";
import type { VectorKey } from "@skillcdn/db";
import {
  createEmbeddingsApi,
  createRerankApi,
  type FetchLike,
  inferenceFetch,
} from "@skillcdn/inference";
import type { EmbeddingsConfig, RerankerConfig } from "../config/config.js";

// The servers of the search by meaning as the configuration names them (ADR-0064, ADR-0065),
// wired to the adapters of @skillcdn/inference the same way in every role that uses them, over
// the package's own transport: the platform's `fetch` ends a call after five minutes whatever
// its timeout says, and an embedding of long texts may be given longer. `userAgent` is what the
// deployment calls itself to them (`userAgentOf`).

export function createEmbedderOf(
  config: EmbeddingsConfig,
  userAgent: string,
  fetchLike: FetchLike = inferenceFetch,
): Embedder {
  return createEmbeddingsApi({
    url: config.url,
    model: config.model,
    dimensions: config.dimensions,
    queryInstruction: config.queryInstruction,
    key: config.key,
    userAgent,
    fetch: fetchLike,
    timeoutMs: config.timeoutMs,
    queryTimeoutMs: config.queryTimeoutMs,
    concurrency: config.concurrency,
    maxTexts: config.batchTexts,
    maxBatchChars: config.batchChars,
    maxTextChars: config.textChars,
    maxTextTokens: config.textTokens,
    maxQueryTokens: config.queryTokens,
  });
}

export function createRerankerOf(
  config: RerankerConfig,
  userAgent: string,
  fetchLike: FetchLike = inferenceFetch,
): Reranker {
  return createRerankApi({
    url: config.url,
    model: config.model,
    key: config.key,
    userAgent,
    fetch: fetchLike,
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
  });
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
