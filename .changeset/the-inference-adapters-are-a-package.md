---
"@skillcdn/inference": patch
---

New package: the adapters of the common embeddings and reranking APIs for the search by meaning (ADR-0064, ADR-0065, ADR-0066), until now inside the server. `createEmbeddingsApi` and `createRerankApi` implement the `Embedder` and `Reranker` ports of `@skillcdn/core` over the two HTTP shapes inference servers share, bounded by a gate and a breaker, with `withQueryCache` remembering recent queries' vectors and `InferenceError` telling a failure worth a retry from one that is not. The `skillcdn` command and a deployment's server embed and rerank with the same code.
