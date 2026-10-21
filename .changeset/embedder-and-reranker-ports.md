---
"@skillcdn/core": patch
---

Adds the `Embedder` and `Reranker` ports of the search by meaning (ADR-0064, ADR-0065): an embedder turns texts into vectors, as documents or as a query, and says its model, its dimensions and what one call takes; a reranker scores candidate texts against a query. Types only; the adapters that speak the common embeddings and reranking APIs live in the server.
