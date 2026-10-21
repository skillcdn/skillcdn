# ADR-0066: The inference adapters are a package of their own

- Status: Accepted
- Date: 2026-10-21
- Builds on [ADR-0064](0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md) (point 1, which placed the adapter in `apps/server` until a second consumer appeared, and point 6, the command's search by meaning) and [ADR-0058](0058-the-published-packages-share-one-version.md).

## Context

ADR-0064 put the `Embedder` port in `core` and its one adapter, the common embeddings API, in `apps/server`, "in its own package or in `apps/server` until a second consumer appears"; ADR-0065 added the `Reranker` port and its adapter beside it. Point 6 of ADR-0064 has the `skillcdn` command serve meaning for a directory when a local model is configured, "by the same adapter at a local URL": the second consumer. The command may import only published packages, never the server, and the rule of the repository is that what has two consumers moves into a package, as the indexer, the reader and the edges did before.

## Decision

1. **`@skillcdn/inference` is a package**, `packages/inference`: the adapters of the common embeddings API and of the common reranking API, the gate and the breaker that bound them, the cache of recent queries' vectors, and the errors told apart by what a caller does about them. It depends on `core` alone, and takes the URL, the model, a key and a `fetch` from its caller, so that it runs in the server, in the command, or in a program of someone else's that has a server to talk to.
2. **The server and the command import it.** `apps/server` wires it from the deployment's configuration; `packages/cli` from the command's environment, against a server on the person's machine. The dependency edges of the repository gain `server → inference`, `cli → inference` and `inference → core`, and nothing else changes: the ports stay in `core`, and what to do about a failed call stays with whoever queues or answers.
3. **Published with the others**, at the shared version of ADR-0058, in the fixed group; its first version is published by hand, as ADR-0046 says of a new package, and the release workflow builds and publishes it from then on. The recorded answers of real servers that the adapters are tested against travel with the package's sources, not with the server's fixtures.

## Consequences

- A person's machine and a deployment speak to an inference server with one code, so that what the command finds by meaning in a directory is what a deployment finds in the same commit once the same model embedded both.
- One more package to version and publish, with nothing in it that was not published inside the server image already.
- Rejected: duplicating the two calls in the command (two implementations of one shape, drifting apart); placing the adapters in `serve` or `client` (neither is about inference servers, and `client` must stay browser-safe); keeping them in the server and having the command shell out to it (the command has no server).
