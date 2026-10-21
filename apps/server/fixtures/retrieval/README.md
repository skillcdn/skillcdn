# The retrieval evaluation set

Questions with the sections that answer them, asked of the `document-pack` fixture in [`../.repositories/document-pack/`](../.repositories/document-pack/), in English and in Korean (ADR-0063). A change to the word rules, to the ranking or, later, to a model is measured against these numbers rather than judged by eye.

`questions.json` holds one entry per question: its `id`, the `language` it is written in, the `query` as a person would type it, and `answers`, the sections that answer it, each as the repository-root `path` of the document and the `heading` path of the section as a search result names it. A question may have several acceptable answers when the handbook says the same thing in two places. Some questions deliberately use other words than the handbook (a synonym, an abbreviation), so that search by words alone does not score perfectly: that gap is what search by meaning is measured on.

What is measured, by `src/testing/retrieval.ts`, over the first page of five results:

| Number | Meaning |
|---|---|
| file@1 | The first result is a document that answers the question. |
| file@5 | A document that answers the question is on the page. |
| section@1 | For the answering document, the first section it names is the answering section. |
| section@2 | The answering section is among the first two it names. |

`src/retrieval.test.ts` runs the set over the fixture with the command's index in memory and holds the numbers at a floor a little under what the lexical search reached when the set was written; `src/retrieval.int.test.ts` runs it against a deployment's index in PostgreSQL and checks that both answer the same. To see the numbers:

```sh
pnpm --filter @skillcdn/server run eval:search
```

The lexical baseline, measured when the set was written (2026-10, reading rules version 11):

| | n | file@1 | file@5 | section@1 | section@2 |
|---|---|---|---|---|---|
| en | 34 | 76% | 100% | 91% | 100% |
| ko | 25 | 88% | 100% | 76% | 100% |
| all | 59 | 81% | 100% | 85% | 100% |

The set is small and its questions are written by the same hands as its documents, so the numbers say what search by words alone does on a pack that is written for it; they are the baseline the models of phase B are compared against, not a claim about search in general.

### What the models measured

The two profiles of [ADR-0065](../../../docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md) and its two alternatives, run over the same set on 2026-10-21 with llama.cpp's server from GGUF files on one machine, an eight-core desktop CPU and a consumer GPU with 8 GB ([the inference server](../../../deploy/README.md#the-inference-server-and-the-model-profiles)), by `pnpm --filter @skillcdn/server run eval:search` given the servers (`--embeddings-url`, `--embeddings-model`, `--reranker-url`, `--reranker-model`, `--instruction`). The Qwen3 embedders took the query instruction of `.env.example`, KURE-v1 none; a reranker scored ten candidates with a timeout long enough to always answer. Percentages over all 59 questions, then the 25 Korean ones; the mean time of a search per question. One question is about two points.

| Configuration | file@1 | file@5 | section@1 | section@2 | ko file@1 | ko section@1 | search |
|---|---|---|---|---|---|---|---|
| words alone | 81% | 100% | 85% | 100% | 88% | 76% | 5 ms |
| base embedder, Qwen3-Embedding-0.6B (Q8_0), CPU | 93% | 100% | 90% | 100% | 100% | 84% | 106 ms |
| base, with Qwen3-Reranker-0.6B (Q8_0), CPU | 93% | 98% | 90% | 98% | 96% | 84% | 5.3 s |
| base embedder, GPU | 93% | 100% | 93% | 100% | 100% | 92% | 16 ms |
| base with its reranker, GPU | 93% | 98% | 93% | 98% | 96% | 92% | 0.4 s |
| quality embedder, Qwen3-Embedding-4B (Q4_K_M), GPU | 93% | 100% | 90% | 98% | 96% | 92% | 28 ms |
| quality embedder (GPU) with the base reranker (CPU) | 92% | 98% | 90% | 98% | 96% | 92% | 5.4 s |
| KURE-v1 (Q8_0), CPU | 95% | 100% | 95% | 98% | 100% | 96% | 42 ms |
| KURE-v1 with Qwen3-Reranker-0.6B, CPU | 95% | 100% | 95% | 98% | 100% | 96% | 5.4 s |
| base embedder with bge-reranker-v2-m3 (Q8_0), CPU | 93% | 98% | 90% | 98% | 100% | 84% | 2.5 s |
| KURE-v1 with bge-reranker-v2-m3, CPU | 95% | 100% | 95% | 98% | 100% | 96% | 2.3 s |

What it says. Meaning lifts the first result from 81% to 93% or more of the questions, and the Korean first result from 88% to 96% or more: the questions written in other words than the handbook are found. On this set no reranker adds anything: ten candidates rescored by Qwen3-Reranker-0.6B or by bge-reranker-v2-m3 leave the numbers where the embedder put them and once push an answer off the page (`en-30`), at five seconds a question on the CPU, past the default `RERANKER_TIMEOUT_MS`, and at half that with bge-reranker-v2-m3; on the GPU the same reranker answers in well under a second. The 4B embedder in four bits is the 0.6B's equal here, better on the Korean sections and worse on the English ones; its 8-bit file was not measured, and neither was the 4B reranker: no published GGUF of Qwen3-Reranker-4B was converted by a llama.cpp that knows the reranker, and one converted before scores at random, so the quality profile's reranker waits for such a conversion. KURE-v1 is the best embedder on this set, in Korean and in English alike, with no instruction to configure. Embedding the pack's 105 sections took the 0.6B embedder 27 seconds on the CPU and under a second on the GPU, KURE-v1 19 seconds on the CPU, the 4B embedder 4 seconds on the GPU. The same embedder on the two kinds of hardware ranks a question or two differently: that is the size of the noise.

What follows for a deployment. On a CPU: the base embedder alone, with no reranker configured, or one given `RERANKER_CANDIDATES` of four to six and `RERANKER_TIMEOUT_MS` of eight thousand if reranking is wanted anyway; where the packs are Korean above all, KURE-v1 without an instruction. On a GPU: the base profile whole, its reranker included, since it costs a fraction of a second there. These are what the set shows on a handbook written for it; a larger set, with more questions in other words, is what the next measurement needs.

Everything here is invented: the handbook describes no real product, company or person.
