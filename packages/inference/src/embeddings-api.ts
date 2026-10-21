import type { Embedder, EmbeddingRole, Embeddings } from "@skillcdn/core";
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

// The common embeddings API (ADR-0064): `POST <url>` with the texts as `input` and the `model`,
// answered with one vector per text under `data`, each with its `index`, and the tokens read under
// `usage`. Hosted and self-hosted servers alike speak it, so this adapter knows nothing of any one
// of them, and a change of model or of server is a change of configuration. The dimensions are not
// asked of the server, which the servers differ in taking: a vector longer than the configured
// dimensions is cut to them here.

export interface EmbeddingsApiOptions {
  /** The endpoint itself, such as `http://inference:8080/v1/embeddings`. Operator configuration. */
  readonly url: string;
  /** What the request names, and what the vectors are keyed by. */
  readonly model: string;
  /**
   * How many numbers every vector has. A longer vector the model answers is cut to them and
   * normalized, as the models trained for it allow (ADR-0065); a shorter one is a wrong model.
   */
  readonly dimensions: number;
  /**
   * The task the model is told before a query, in the two lines the instruction-tuned models
   * take: `Instruct: <task>` and `Query:<text>` (ADR-0065). Unset, a query is sent as it is, as
   * a document always is.
   */
  readonly queryInstruction: string | undefined;
  /** Sent as a bearer token when the server wants one. */
  readonly key: string | undefined;
  readonly userAgent: string;
  readonly fetch: FetchLike;
  /** How long a call embedding documents may take, waiting for its turn included. */
  readonly timeoutMs: number;
  /** The same for a call embedding a query, which a search waits for. */
  readonly queryTimeoutMs: number;
  /** Calls in flight at once from this process; the rest wait their turn, within their timeout. */
  readonly concurrency?: number | undefined;
  /** The most texts in one call; more are refused. */
  readonly maxTexts?: number | undefined;
  /** What a text is cut to before it is embedded. */
  readonly maxTextChars?: number | undefined;
  /** The most characters in one call, over its texts once each is cut; more are refused. */
  readonly maxBatchChars?: number | undefined;
  readonly breaker?: BreakerOptions | undefined;
  /** The clock of the gate and the breaker. */
  readonly now?: (() => number) | undefined;
}

/** Two calls keep a CPU server busy without queueing a search behind a worker's batches. */
const DEFAULT_CONCURRENCY = 2;
/** A batch of sixteen sections is a few seconds on a CPU; a GPU takes more and is told so. */
const DEFAULT_MAX_TEXTS = 16;
/** Two to four thousand tokens of most scripts: a section, and within the window of the models. */
const DEFAULT_MAX_TEXT_CHARS = 8_000;
/** Some ten thousand tokens: what one call costs the server is bounded whatever the sections. */
const DEFAULT_MAX_BATCH_CHARS = 32_000;
/** Three failures in a row, and the server is left alone for ten seconds. */
const DEFAULT_BREAKER: BreakerOptions = { failures: 3, cooldownMs: 10_000 };
/** A number written out is some twenty bytes; this bounds a server that answers something else. */
const MAX_REPLY_BYTES = 64 * 1024 * 1024;

const replySchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative().optional(),
      embedding: z.array(z.number()),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      total_tokens: z.number().nonnegative().optional(),
    })
    .optional(),
});

/**
 * The vector as the column holds it: a vector of the configured dimensions as it is, a longer one
 * cut to its first `dimensions` numbers and brought back to length one, which is how a model of
 * more dimensions fills the one column (ADR-0065).
 */
function toVector(numbers: readonly number[], dimensions: number): Float32Array {
  if (numbers.length === dimensions) {
    return Float32Array.from(numbers);
  }
  const vector = Float32Array.from(numbers.slice(0, dimensions));
  let sum = 0;
  for (const number of vector) {
    sum += number * number;
  }
  const length = Math.sqrt(sum);
  if (length > 0) {
    for (let at = 0; at < vector.length; at += 1) {
      vector[at] = (vector[at] ?? 0) / length;
    }
  }
  return vector;
}

export function createEmbeddingsApi(options: EmbeddingsApiOptions): Embedder {
  const maxTexts = options.maxTexts ?? DEFAULT_MAX_TEXTS;
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const maxBatchChars = options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const gate = createGate(options.concurrency ?? DEFAULT_CONCURRENCY, options.now);
  const breaker = createBreaker(options.breaker ?? DEFAULT_BREAKER, options.now);
  const { queryInstruction } = options;
  const prepare = (text: string, as: EmbeddingRole): string => {
    const cut = cutText(text, maxTextChars);
    return as === "query" && queryInstruction !== undefined
      ? `Instruct: ${queryInstruction}\nQuery:${cut}`
      : cut;
  };
  const tooMany = (what: string) => new InferenceError("inference_too_many", what);
  const malformed = (what: string) =>
    new InferenceError("inference_malformed", `the embeddings server answered ${what}`);

  return {
    model: options.model,
    dimensions: options.dimensions,
    maxTexts,
    maxTextChars,
    maxBatchChars,
    async embed(texts, as): Promise<Embeddings> {
      if (texts.length > maxTexts) {
        throw tooMany(`${texts.length} texts in one call, where ${maxTexts} is the most`);
      }
      if (texts.length === 0) {
        return { vectors: [], tokens: 0 };
      }
      const input = texts.map((text) => prepare(text, as));
      const chars = input.reduce((sum, text) => sum + text.length, 0);
      if (chars > maxBatchChars) {
        throw tooMany(`${chars} characters in one call, where ${maxBatchChars} is the most`);
      }
      const timeoutMs = as === "query" ? options.queryTimeoutMs : options.timeoutMs;
      const reply = await gate.run(timeoutMs, (remainingMs) =>
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
            { model: options.model, input, encoding_format: "float" },
          ),
        ),
      );
      const parsed = replySchema.safeParse(reply);
      if (!parsed.success) {
        throw malformed("something other than embeddings");
      }
      const vectors: (Float32Array | undefined)[] = Array.from(texts, () => undefined);
      for (const [position, item] of parsed.data.data.entries()) {
        const at = item.index ?? position;
        if (at >= texts.length || vectors[at] !== undefined) {
          throw malformed(`a vector for text ${at} of ${texts.length}, or two of them`);
        }
        if (item.embedding.length < options.dimensions) {
          throw malformed(
            `vectors of ${item.embedding.length} dimensions where ${options.dimensions} are configured`,
          );
        }
        vectors[at] = toVector(item.embedding, options.dimensions);
      }
      const complete = vectors.filter((vector): vector is Float32Array => vector !== undefined);
      if (complete.length !== texts.length) {
        throw malformed(`${complete.length} vectors for ${texts.length} texts`);
      }
      const usage = parsed.data.usage;
      return { vectors: complete, tokens: usage?.prompt_tokens ?? usage?.total_tokens };
    },
  };
}
