import { describe, expect, it } from "vitest";
import { type FetchLike, InferenceError } from "./inference.js";
import { createRerankApi, type RerankApiOptions } from "./rerank-api.js";

const URL_ = "http://inference.test/v1/rerank";

interface Seen {
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function serving(reply: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetchLike: FetchLike = async (_url, init) => {
    const call: Seen = {
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
    seen.push(call);
    return reply(call);
  };
  return { fetchLike, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const api = (fetchLike: FetchLike, extra: Partial<RerankApiOptions> = {}) =>
  createRerankApi({
    url: URL_,
    model: "test-reranker",
    key: undefined,
    userAgent: "skillcdn-test",
    fetch: fetchLike,
    timeoutMs: 1000,
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

describe("the reranking API adapter", () => {
  it("scores the candidates in their order from a reply of results with relevance scores", async () => {
    const { fetchLike, seen } = serving(() =>
      json({
        id: "rerank-1",
        model: "test-reranker",
        results: [
          { index: 2, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.12 },
          { index: 1, relevance_score: 0.4 },
        ],
        usage: { total_tokens: 40 },
      }),
    );
    const reranker = api(fetchLike, { key: "a-key" });
    expect(reranker).toMatchObject({ model: "test-reranker", maxCandidates: 32 });
    await expect(reranker.rerank("where is it indexed", ["a", "b", "c"])).resolves.toEqual([
      0.12, 0.4, 0.91,
    ]);
    // The request spells the candidates both ways and asks for every score.
    expect(seen[0]?.body).toEqual({
      model: "test-reranker",
      query: "where is it indexed",
      documents: ["a", "b", "c"],
      texts: ["a", "b", "c"],
      top_n: 3,
      return_documents: false,
      truncate: true,
    });
    expect(seen[0]?.headers.authorization).toBe("Bearer a-key");
  });

  it("reads a bare list of index and score as well", async () => {
    const { fetchLike } = serving(() =>
      json([
        { index: 1, score: 0.8 },
        { index: 0, score: 0.3 },
      ]),
    );
    await expect(api(fetchLike).rerank("q", ["a", "b"])).resolves.toEqual([0.3, 0.8]);
  });

  it("cuts a candidate before it is sent, and makes no call for none", async () => {
    const { fetchLike, seen } = serving(() => json({ results: [{ index: 0, score: 1 }] }));
    const reranker = api(fetchLike, { maxCandidateChars: 4 });
    await reranker.rerank("q", ["abcdefgh"]);
    expect(seen[0]?.body.documents).toEqual(["abcd"]);
    expect(seen[0]?.body.texts).toEqual(["abcd"]);
    await expect(reranker.rerank("q", [])).resolves.toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("refuses more candidates than one call takes", async () => {
    const { fetchLike, seen } = serving(() => json([]));
    await expect(
      codeOf(api(fetchLike, { maxCandidates: 2 }).rerank("q", ["a", "b", "c"])),
    ).resolves.toBe("inference_too_many");
    expect(seen).toHaveLength(0);
  });

  it("answers malformed for a candidate without a score, an unknown one, a repeated one and something else", async () => {
    const replies = [
      json({ results: [{ index: 0, relevance_score: 0.5 }] }),
      json({ results: [{ index: 0, relevance_score: 0.5 }, { index: 1 }] }),
      json({
        results: [
          { index: 0, score: 0.5 },
          { index: 7, score: 0.1 },
        ],
      }),
      json({
        results: [
          { index: 0, score: 0.5 },
          { index: 0, score: 0.1 },
        ],
      }),
      json({ scores: [0.1, 0.2] }),
      new Response("[]", { status: 200 }),
    ];
    let nth = 0;
    const { fetchLike } = serving(() => replies[nth++] ?? json({}));
    const reranker = api(fetchLike);
    for (const _reply of replies) {
      await expect(codeOf(reranker.rerank("q", ["a", "b"]))).resolves.toBe("inference_malformed");
    }
  });

  it("passes on what the server did: refused, failed, overloaded, away", async () => {
    const statuses = [404, 500, 429];
    let nth = 0;
    const { fetchLike } = serving(() => new Response("", { status: statuses[nth++] ?? 200 }));
    const reranker = api(fetchLike);
    await expect(codeOf(reranker.rerank("q", ["a"]))).resolves.toBe("inference_refused");
    await expect(codeOf(reranker.rerank("q", ["a"]))).resolves.toBe("inference_failed");
    await expect(codeOf(reranker.rerank("q", ["a"]))).resolves.toBe("inference_busy");
    const away = api(() => Promise.reject(new TypeError("fetch failed")));
    await expect(codeOf(away.rerank("q", ["a"]))).resolves.toBe("inference_unreachable");
  });
});
