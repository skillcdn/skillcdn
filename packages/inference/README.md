<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/inference</h1>
<p align="center">The adapters of the common embeddings and reranking APIs, for the search by meaning of SkillCDN.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/inference"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/inference"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

The `Embedder` and `Reranker` ports of [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core) implemented over the two HTTP shapes that inference servers share ([ADR-0064](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md), [ADR-0066](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0066-the-inference-adapters-are-a-package-of-their-own.md)): `POST <url>` with `input` and `model`, answered with one vector per text under `data`; and `POST <url>` with `query` and the candidates, answered with each candidate's index and score, in either of its spellings. A deployment's server embeds the sections of indexed commits and the queries of its searches with them, and the `skillcdn` command embeds a directory and its queries with the same code against a server on the person's machine. No server's SDK: a change of server or of model is a change of the URL and the model name.

## What it exports

| Export | What it does |
|---|---|
| `createEmbeddingsApi(options)` | An `Embedder` over the common embeddings shape: the URL, the model, the dimensions every vector is cut to (a longer vector is cut and normalized, as the models trained for it allow), the one-line instruction put in front of a query and never of a document, a bearer key, and how much one call takes (`maxTexts`, `maxTextChars`, `maxBatchChars`). |
| `createRerankApi(options)` | A `Reranker` over the common reranking shape: the URL, the model, a bearer key, and how many candidates one call takes, each cut to `maxCandidateChars`. The request carries the candidates under `documents` and `texts` both; the answer is read with `results` or without, and with `relevance_score` or `score`. |
| `withQueryCache(embedder, options)` | The embedder with the vectors of recent queries remembered in the process, so that the next page of a search costs no call. Bounded in number and in time. |
| `createGate(concurrency)`, `createBreaker(options)` | What bounds the adapters, for an adapter of another shape: a gate lets a few calls run at once from one process and sheds a call that cannot start within its timeout as `inference_busy`; a breaker stops asking a server that failed a few times in a row for a while, failing at once as `inference_unreachable`. |
| `InferenceError`, `isTransientInferenceError`, `cutText`, `FetchLike` | A failure by what the caller does about it: `inference_unreachable`, `inference_busy` and `inference_failed` are the server's moment and worth a retry by whoever queues the call; `inference_refused`, `inference_malformed` and `inference_too_many` are not. A text cut never splits a character. The adapters take any `fetch`. |

The adapters retry nothing themselves: a worker retries through its queue, a search answers by words alone. Node.js 24 or newer; the platform's `fetch` unless another is given.

## Tests

The shapes are tested against what real inference servers answered, recorded once in [`fixtures/recorded/`](fixtures/recorded/README.md), so that no test calls a server.
