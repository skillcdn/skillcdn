import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmbeddingsApi } from "./embeddings-api.js";
import type { FetchLike } from "./inference.js";
import { createRerankApi } from "./rerank-api.js";

// What a real inference server answered, recorded once (fixtures/recorded/README.md): the
// adapters read the shapes a server writes, the reranking shape in both of its forms from the
// same server, and ask what they were recorded asking.

interface Recorded {
  readonly request: Readonly<Record<string, unknown>>;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function recorded(file: string, name: string): Recorded {
  const fixture = JSON.parse(
    readFileSync(new URL(`../fixtures/recorded/${file}`, import.meta.url), "utf8"),
  ) as { readonly responses: Readonly<Record<string, Recorded>> };
  const reply = fixture.responses[name];
  if (reply === undefined) {
    throw new Error(`no recording ${name} in ${file}`);
  }
  return reply;
}

/** Answers every call with the one recorded reply, and remembers what the adapter asked. */
function replaying(reply: Recorded): {
  readonly fetchLike: FetchLike;
  readonly asked: () => unknown;
} {
  let asked: unknown;
  const fetchLike: FetchLike = async (_url, init) => {
    asked = JSON.parse(init.body as string);
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  };
  return { fetchLike, asked: () => asked };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`nothing at ${index}`);
  }
  return item;
}

const strings = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("expected a list of texts in the recorded request");
  }
  return value;
};

const embedder = (fetchLike: FetchLike) =>
  createEmbeddingsApi({
    url: "http://inference.test/v1/embeddings",
    model: "Qwen3-Embedding-0.6B-Q8_0",
    dimensions: 1024,
    queryInstruction:
      "Given a question about a set of documents, retrieve the sections that answer it",
    key: undefined,
    userAgent: "skillcdn-test",
    fetch: fetchLike,
    timeoutMs: 1000,
    queryTimeoutMs: 1000,
  });

const reranker = (fetchLike: FetchLike) =>
  createRerankApi({
    url: "http://inference.test/v1/rerank",
    model: "qwen3-reranker-0.6b-q8_0",
    key: undefined,
    userAgent: "skillcdn-test",
    fetch: fetchLike,
    timeoutMs: 1000,
  });

describe("the adapters read what an inference server answered", () => {
  it("takes the vectors of documents, of the model's dimensions and length one", async () => {
    const reply = recorded("embeddings.json", "documents");
    const { fetchLike, asked } = replaying(reply);
    const { vectors, tokens } = await embedder(fetchLike).embed(
      strings(reply.request.input),
      "document",
    );
    expect(vectors).toHaveLength(3);
    expect(vectors.every((vector) => vector.length === 1024)).toBe(true);
    expect(tokens).toBe(85);
    const first = at(vectors, 0);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 3);
    expect(asked()).toEqual(reply.request);
  });

  it("tells a query its task, as the model takes it, and gets one vector back", async () => {
    const reply = recorded("embeddings.json", "query");
    const { fetchLike, asked } = replaying(reply);
    const { vectors, tokens } = await embedder(fetchLike).embed(["What is a pack?"], "query");
    expect(vectors).toHaveLength(1);
    expect(at(vectors, 0)).toHaveLength(1024);
    expect(tokens).toBe(27);
    expect(asked()).toEqual(reply.request);
  });

  it("reads the scores in both shapes the server writes, and the same order from each", async () => {
    const bare = recorded("rerank.json", "both-spellings");
    const wrapped = recorded("rerank.json", "documents-only");
    const candidates = strings(bare.request.documents);
    const query = String(bare.request.query);

    const fromBare = replaying(bare);
    const scores = await reranker(fromBare.fetchLike).rerank(query, candidates);
    expect(fromBare.asked()).toEqual(bare.request);
    const fromWrapped = replaying(wrapped);
    await expect(reranker(fromWrapped.fetchLike).rerank(query, candidates)).resolves.toEqual(
      scores,
    );

    // The one candidate that answers the question scores near one, the others near nothing.
    expect(scores).toHaveLength(4);
    expect(at(scores, 1)).toBeGreaterThan(0.99);
    expect(Math.max(at(scores, 0), at(scores, 2), at(scores, 3))).toBeLessThan(0.01);
  });
});
