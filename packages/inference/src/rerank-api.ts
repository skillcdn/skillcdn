import type { Reranker } from "@skillcdn/core";
import * as z from "zod";
import {
  type BreakerOptions,
  createBreaker,
  createGate,
  cutText,
  type FetchLike,
  InferenceError,
  postJson,
} from "./inference.js";

// The common reranking API (ADR-0065): `POST <url>` with the `query`, the candidates and how many
// to return, answered with each candidate's index and score. The servers spell the candidates
// `documents` or `texts` and the score `relevance_score` or `score`, and wrap the list in
// `results` or not: the request carries both spellings, and the answer is read either way.

export interface RerankApiOptions {
  /** The endpoint itself, such as `http://inference:8080/v1/rerank`. Operator configuration. */
  readonly url: string;
  readonly model: string;
  /** Sent as a bearer token when the server wants one. */
  readonly key: string | undefined;
  readonly userAgent: string;
  readonly fetch: FetchLike;
  /** How long a call may take, waiting for its turn included: a search waits for it. */
  readonly timeoutMs: number;
  /** Calls in flight at once from this process; the rest wait their turn, within their timeout. */
  readonly concurrency?: number | undefined;
  /** The most candidates in one call; more are refused. */
  readonly maxCandidates?: number | undefined;
  /** What a candidate is cut to before it is sent. */
  readonly maxCandidateChars?: number | undefined;
  readonly breaker?: BreakerOptions | undefined;
  /** The clock of the gate and the breaker. */
  readonly now?: (() => number) | undefined;
}

const DEFAULT_CONCURRENCY = 2;
/** What inference servers take in one request unless told otherwise, and the first results of a search. */
const DEFAULT_MAX_CANDIDATES = 32;
/** About a thousand tokens: the beginning of a section is what decides its relevance. */
const DEFAULT_MAX_CANDIDATE_CHARS = 4_000;
const DEFAULT_BREAKER: BreakerOptions = { failures: 3, cooldownMs: 10_000 };
const MAX_REPLY_BYTES = 4 * 1024 * 1024;

const scoredSchema = z.object({
  index: z.number().int().nonnegative(),
  relevance_score: z.number().optional(),
  score: z.number().optional(),
});
const replySchema = z.union([z.object({ results: z.array(scoredSchema) }), z.array(scoredSchema)]);

export function createRerankApi(options: RerankApiOptions): Reranker {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxCandidateChars = options.maxCandidateChars ?? DEFAULT_MAX_CANDIDATE_CHARS;
  const gate = createGate(options.concurrency ?? DEFAULT_CONCURRENCY, options.now);
  const breaker = createBreaker(options.breaker ?? DEFAULT_BREAKER, options.now);
  const malformed = (what: string) =>
    new InferenceError("inference_malformed", `the reranking server answered ${what}`);

  return {
    model: options.model,
    maxCandidates,
    async rerank(query, candidates): Promise<readonly number[]> {
      if (candidates.length > maxCandidates) {
        throw new InferenceError(
          "inference_too_many",
          `${candidates.length} candidates in one call, where ${maxCandidates} is the most`,
        );
      }
      if (candidates.length === 0) {
        return [];
      }
      const texts = candidates.map((candidate) => cutText(candidate, maxCandidateChars));
      const reply = await gate.run(options.timeoutMs, (remainingMs) =>
        breaker.run(() =>
          postJson(
            {
              url: options.url,
              key: options.key,
              userAgent: options.userAgent,
              fetch: options.fetch,
              timeoutMs: remainingMs,
              maxReplyBytes: MAX_REPLY_BYTES,
            },
            {
              model: options.model,
              query,
              documents: texts,
              texts,
              top_n: texts.length,
              return_documents: false,
              truncate: true,
            },
          ),
        ),
      );
      const parsed = replySchema.safeParse(reply);
      if (!parsed.success) {
        throw malformed("something other than scores");
      }
      const items = Array.isArray(parsed.data) ? parsed.data : parsed.data.results;
      const scores: (number | undefined)[] = Array.from(candidates, () => undefined);
      for (const item of items) {
        const score = item.relevance_score ?? item.score;
        if (score === undefined) {
          throw malformed(`candidate ${item.index} without a score`);
        }
        if (item.index >= candidates.length || scores[item.index] !== undefined) {
          throw malformed(`a score for candidate ${item.index} of ${candidates.length}, or two`);
        }
        scores[item.index] = score;
      }
      const complete = scores.filter((score): score is number => score !== undefined);
      if (complete.length !== candidates.length) {
        throw malformed(`${complete.length} scores for ${candidates.length} candidates`);
      }
      return complete;
    },
  };
}
