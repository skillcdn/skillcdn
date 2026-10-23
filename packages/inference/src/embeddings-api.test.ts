import { describe, expect, it } from "vitest";
import { createEmbeddingsApi, type EmbeddingsApiOptions } from "./embeddings-api.js";
import { type FetchLike, InferenceError } from "./inference.js";

const URL_ = "http://inference.test/v1/embeddings";
const DIMENSIONS = 8;

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

/** A server that answers every call with `reply`, remembering what it was asked. */
function serving(reply: (seen: Seen, nth: number) => Response) {
  const seen: Seen[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    const call: Seen = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
    seen.push(call);
    return reply(call, seen.length);
  };
  return { fetchLike, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const vector = (seed: number, dimensions = DIMENSIONS) =>
  Array.from({ length: dimensions }, (_, at) => Math.round(Math.sin(seed + at) * 1000) / 1000);

/** The common reply: one vector per text, under `data`, in whatever order. */
const embeddings = (indexes: readonly number[], usage?: Record<string, number>) =>
  json({
    object: "list",
    data: indexes.map((index) => ({ object: "embedding", index, embedding: vector(index) })),
    model: "test-embedding",
    ...(usage === undefined ? {} : { usage }),
  });

const api = (fetchLike: FetchLike, extra: Partial<EmbeddingsApiOptions> = {}) =>
  createEmbeddingsApi({
    url: URL_,
    model: "test-embedding",
    dimensions: DIMENSIONS,
    queryInstruction: undefined,
    key: undefined,
    userAgent: "skillcdn-test",
    fetch: fetchLike,
    timeoutMs: 1000,
    queryTimeoutMs: 500,
    ...extra,
  });

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof InferenceError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
};

describe("the embeddings API adapter", () => {
  it("embeds documents as they are, and puts the vectors in the texts' order", async () => {
    const { fetchLike, seen } = serving(() =>
      embeddings([2, 0, 1], { prompt_tokens: 12, total_tokens: 12 }),
    );
    const embedder = api(fetchLike);
    expect(embedder).toMatchObject({
      model: "test-embedding",
      dimensions: DIMENSIONS,
      maxTexts: 16,
      maxTextChars: 8_000,
      maxBatchChars: 32_000,
    });

    const { vectors, tokens } = await embedder.embed(["one", "two", "three"], "document");
    expect(tokens).toBe(12);
    expect(vectors).toHaveLength(3);
    expect(vectors.every((item) => item instanceof Float32Array)).toBe(true);
    expect(Array.from(vectors[0] ?? [])).toEqual(vector(0).map(Math.fround));
    expect(Array.from(vectors[2] ?? [])).toEqual(vector(2).map(Math.fround));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(URL_);
    expect(seen[0]?.body).toEqual({
      model: "test-embedding",
      input: ["one", "two", "three"],
      encoding_format: "float",
    });
    expect(seen[0]?.headers).not.toHaveProperty("authorization");
    expect(seen[0]?.headers["user-agent"]).toBe("skillcdn-test");
  });

  it("tells a query the task it was configured with, and sends the credential", async () => {
    const { fetchLike, seen } = serving(() => embeddings([0]));
    const embedder = api(fetchLike, {
      queryInstruction: "Given a question, retrieve the sections that answer it",
      key: "a-key",
    });
    await embedder.embed(["how is a pack indexed"], "query");
    expect(seen[0]?.body.input).toEqual([
      "Instruct: Given a question, retrieve the sections that answer it\nQuery:how is a pack indexed",
    ]);
    expect(seen[0]?.headers.authorization).toBe("Bearer a-key");
    // A document is never told the task.
    await embedder.embed(["how is a pack indexed"], "document");
    expect(seen[1]?.body.input).toEqual(["how is a pack indexed"]);
  });

  it("takes the tokens as the server counts them, and none when it does not say", async () => {
    const { fetchLike } = serving((_seen, nth) =>
      nth === 1 ? embeddings([0], { total_tokens: 7 }) : embeddings([0]),
    );
    const embedder = api(fetchLike);
    await expect(embedder.embed(["a"], "document")).resolves.toMatchObject({ tokens: 7 });
    await expect(embedder.embed(["a"], "document")).resolves.toMatchObject({ tokens: undefined });
  });

  it("cuts a long text before it is sent, and makes no call for no texts", async () => {
    const { fetchLike, seen } = serving(() => embeddings([0, 1]));
    const embedder = api(fetchLike, { maxTextChars: 5 });
    const smile = String.fromCodePoint(0x1f600);
    await embedder.embed(["abcdefgh", `abcd${smile}f`], "document");
    expect(seen[0]?.body.input).toEqual(["abcde", "abcd"]);
    await expect(embedder.embed([], "document")).resolves.toEqual({ vectors: [], tokens: 0 });
    expect(seen).toHaveLength(1);
  });

  it("refuses a call with more texts, or more text, than one call takes", async () => {
    const { fetchLike, seen } = serving(() => embeddings([0]));
    const embedder = api(fetchLike, { maxTexts: 2, maxBatchChars: 10 });
    await expect(codeOf(embedder.embed(["a", "b", "c"], "document"))).resolves.toBe(
      "inference_too_many",
    );
    await expect(codeOf(embedder.embed(["abcdef", "ghijkl"], "document"))).resolves.toBe(
      "inference_too_many",
    );
    expect(seen).toHaveLength(0);
  });

  it("cuts a longer vector to the configured dimensions and brings it back to length one", async () => {
    const { fetchLike } = serving(() =>
      json({ data: [{ index: 0, embedding: [3, 4, 0, 0, 0, 0, 0, 0, 9, 9, 9, 9] }] }),
    );
    const { vectors } = await api(fetchLike).embed(["a"], "document");
    expect(Array.from(vectors[0] ?? [])).toEqual([0.6, 0.8, 0, 0, 0, 0, 0, 0].map(Math.fround));
  });

  it("answers malformed for vectors of fewer dimensions, for a missing one and for something else", async () => {
    const replies = [
      json({ data: [{ index: 0, embedding: vector(0, 7) }] }),
      json({ data: [{ index: 0, embedding: vector(0) }] }),
      json({
        data: [
          { index: 0, embedding: vector(0) },
          { index: 0, embedding: vector(0) },
        ],
      }),
      json({ data: [{ index: 5, embedding: vector(0) }] }),
      json({ error: "nothing" }),
    ];
    const { fetchLike } = serving((_seen, nth) => replies[nth - 1] ?? json({}));
    const embedder = api(fetchLike);
    const sizes = embedder.embed(["a"], "document");
    await expect(sizes).rejects.toThrow("7 dimensions where 8 are configured");
    for (let reply = 1; reply < replies.length; reply += 1) {
      await expect(codeOf(embedder.embed(["a", "b"], "document"))).resolves.toBe(
        "inference_malformed",
      );
    }
  });

  it("says what shape an answer that is not embeddings had, and never what it said", async () => {
    const replies = [
      json({ error: "nothing", detail: "secret text" }),
      json([1, 2, 3]),
      json("a plain string"),
    ];
    const { fetchLike } = serving((_seen, nth) => replies[nth - 1] ?? json({}));
    const embedder = api(fetchLike);
    await expect(embedder.embed(["a"], "document")).rejects.toThrow(
      "something other than embeddings: an object with keys error, detail",
    );
    const list = embedder.embed(["a"], "document");
    await expect(list).rejects.toThrow("an array of 3, the first a number");
    await expect(list).rejects.not.toThrow("secret");
    await expect(embedder.embed(["a"], "document")).rejects.toThrow("a string of 14 characters");
  });

  it("takes vectors without an index in the order they come", async () => {
    const { fetchLike } = serving(() =>
      json({ data: [{ embedding: vector(0) }, { embedding: vector(1) }] }),
    );
    const { vectors } = await api(fetchLike).embed(["a", "b"], "document");
    expect(Array.from(vectors[1] ?? [])).toEqual(vector(1).map(Math.fround));
  });

  it("waits a query no longer than its own timeout, its turn included", async () => {
    // One slot, held by a document call: the query cannot start, and fails as busy in time.
    let release: () => void = () => {};
    const held = new Promise<Response>((resolve) => {
      release = () => resolve(embeddings([0]));
    });
    const { fetchLike } = serving((_seen, nth) => {
      if (nth === 1) {
        throw held;
      }
      return embeddings([0]);
    });
    const holding: FetchLike = async (url, init) =>
      fetchLike(url, init).catch((pending: unknown) => pending as Promise<Response>);
    const embedder = api(holding, { concurrency: 1, queryTimeoutMs: 20 });
    const documents = embedder.embed(["a"], "document");
    await expect(codeOf(embedder.embed(["q"], "query"))).resolves.toBe("inference_busy");
    release();
    await expect(documents).resolves.toMatchObject({ tokens: undefined });
  });

  it("leaves a server alone after it failed repeatedly", async () => {
    let clock = 0;
    const { fetchLike, seen } = serving(() => new Response("down", { status: 502 }));
    const embedder = api(fetchLike, {
      breaker: { failures: 2, cooldownMs: 1000 },
      now: () => clock,
    });
    await expect(codeOf(embedder.embed(["a"], "document"))).resolves.toBe("inference_failed");
    await expect(codeOf(embedder.embed(["a"], "document"))).resolves.toBe("inference_failed");
    await expect(codeOf(embedder.embed(["a"], "document"))).resolves.toBe("inference_unreachable");
    expect(seen).toHaveLength(2);
    clock = 1000;
    await expect(codeOf(embedder.embed(["a"], "document"))).resolves.toBe("inference_failed");
    expect(seen).toHaveLength(3);
  });
});
