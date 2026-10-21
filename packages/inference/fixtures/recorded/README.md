# Recorded answers of inference servers

What the embeddings and reranking servers of the search by meaning ([ADR-0064](../../../../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](../../../../docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)) answered to the adapters in `src/`, recorded from a server run on a developer's machine, so that the adapter tests read the shapes a real server writes and never call one.

Each file names the server, the model and the flags it was recorded with, and holds `responses` by name: the request the adapter sent (`request`), the status, the content type and the body as it came (`body`), and how long the call took (`ms`, on a CPU, for a sense of proportion only).

- `embeddings.json`: the common embeddings shape. `documents` embeds three short texts, one of them Korean, as documents; `query` embeds one question as a query, with the task instruction in front of it. Every vector has the model's 1024 dimensions. The server ignores a `dimensions` field, which is why the adapter asks for none and cuts a longer vector itself.
- `rerank.json`: the common reranking shape, in both of its forms from the same server. `both-spellings` is the adapter's own request, with the candidates under `documents` and `texts`; the server answers that with the bare list of `index` and `score`. `documents-only` names the candidates under `documents` alone, and is answered with `results` of `index` and `relevance_score`, with `usage`.

To record again, run the servers (the compose bundle of the roadmap, or two containers of the inference server's image with the two models) and a script that calls the adapters with a `fetch` that writes each reply down; the shapes change only when the servers do.
