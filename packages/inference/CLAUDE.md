# packages/inference: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is the two inference adapters of the search by meaning, shared by the server and the command (ADR-0066).

- **Two shapes, no SDK.** The common embeddings API and the common reranking API, as the inference servers share them; a server's own fields are read where they differ in spelling and never required. A new kind of server is configuration, not code, until its shape differs.
- **Bounded, never retrying.** Every call goes through the gate and the breaker and ends within its timeout; what to do about a failure is the caller's, which `isTransientInferenceError` tells apart. No retry, no queue, no sleep in here.
- **Nothing of a request in an error.** A refusal keeps a short excerpt of what the server said, with control characters removed; a text that was embedded is never in a message or a log.
- **`core` only.** The ports come from `@skillcdn/core`; nothing else of the workspace is imported, so that the command carries this without the server's dependencies.
- **Recorded, not called.** The tests read what a real server answered once ([fixtures/recorded](fixtures/recorded/README.md)); a shape that changes is recorded again, never guessed.
