import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createEmbeddingsApi, createRerankApi } from "@skillcdn/inference";
import {
  evaluateRetrieval,
  formatRetrievalReport,
  loadRetrievalSet,
  type MemorySearch,
  memorySearch,
  memorySearchWithMeaning,
  type RetrievalQuestion,
} from "./evaluate.js";

// `pnpm --filter @skillcdn/server run eval:search [directory] [questions.json] [--embeddings-url
// <url> --embeddings-model <model> [--dimensions <n>] [--instruction <text>] [--reranker-url <url>
// --reranker-model <model>] [--candidates <n>]`: the numbers of the retrieval evaluation set over
// a directory read as the command reads it, by words alone and, given an embeddings server, by
// words and meaning as well, with what the embedding and each search took. For a person who
// changed the word rules, the ranking or the set, or who measures a model profile (ADR-0065).

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    "embeddings-url": { type: "string" },
    "embeddings-model": { type: "string" },
    dimensions: { type: "string", default: "1024" },
    instruction: { type: "string" },
    "embeddings-key": { type: "string" },
    "reranker-url": { type: "string" },
    "reranker-model": { type: "string" },
    "reranker-key": { type: "string" },
    candidates: { type: "string", default: "10" },
    /** How long a call may take: an evaluation waits for a slow server rather than lose the answer. */
    "timeout-ms": { type: "string", default: "600000" },
  },
});
const [directory, questions] = positionals;
const set = loadRetrievalSet(questions === undefined ? undefined : resolve(questions));
const write = (text: string): void => {
  process.stdout.write(text);
};
const fetchLike = (input: string, init: RequestInit) => fetch(input, init);
const userAgent = "skillcdn-eval";
const timeoutMs = Number(values["timeout-ms"]);

/** Runs the set, timing every search; the numbers, and the milliseconds a search took. */
async function measure(find: MemorySearch): Promise<{
  readonly report: string;
  readonly mean: number;
  readonly p95: number;
  readonly reranked: number;
  readonly byMeaning: number;
}> {
  const times: number[] = [];
  let reranked = 0;
  let byMeaning = 0;
  const score = await evaluateRetrieval(set, async (question: RetrievalQuestion) => {
    const started = performance.now();
    const result = await find(question.query);
    times.push(performance.now() - started);
    if (result.ranking?.meaning === true) byMeaning += 1;
    if (result.ranking?.reranked === true) reranked += 1;
    return result;
  });
  const sorted = [...times].sort((a, b) => a - b);
  return {
    report: formatRetrievalReport(score),
    mean: times.reduce((sum, time) => sum + time, 0) / Math.max(1, times.length),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    reranked,
    byMeaning,
  };
}

const where = directory === undefined ? undefined : resolve(directory);
const words = await measure(await memorySearch(where));
write(
  `words alone\n${words.report}search: mean ${words.mean.toFixed(0)} ms, p95 ${words.p95.toFixed(0)} ms\n`,
);

const embeddingsUrl = values["embeddings-url"];
const embeddingsModel = values["embeddings-model"];
if (embeddingsUrl !== undefined && embeddingsModel !== undefined) {
  const embedder = createEmbeddingsApi({
    url: embeddingsUrl,
    model: embeddingsModel,
    dimensions: Number(values.dimensions),
    queryInstruction: values.instruction,
    key: values["embeddings-key"],
    userAgent,
    fetch: fetchLike,
    timeoutMs,
    queryTimeoutMs: timeoutMs,
  });
  const rerankerUrl = values["reranker-url"];
  const rerankerModel = values["reranker-model"];
  const reranker =
    rerankerUrl === undefined || rerankerModel === undefined
      ? undefined
      : createRerankApi({
          url: rerankerUrl,
          model: rerankerModel,
          key: values["reranker-key"],
          userAgent,
          fetch: fetchLike,
          timeoutMs,
        });
  const { find, embedded } = await memorySearchWithMeaning(
    { embedder, reranker, rerankCandidates: Number(values.candidates) },
    where,
  );
  const meaning = await measure(find);
  write(
    `\nwords and meaning: ${embeddingsModel}${reranker === undefined ? "" : `, reranked by ${rerankerModel} (${values.candidates} candidates)`}\n${meaning.report}embedding: ${embedded.bodies} bodies, ${embedded.sections} sections in ${(embedded.milliseconds / 1000).toFixed(1)} s\nsearch: mean ${meaning.mean.toFixed(0)} ms, p95 ${meaning.p95.toFixed(0)} ms; by meaning ${meaning.byMeaning}/${set.questions.length}, reranked ${meaning.reranked}/${set.questions.length}\n`,
  );
}
