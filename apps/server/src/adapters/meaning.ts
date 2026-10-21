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
