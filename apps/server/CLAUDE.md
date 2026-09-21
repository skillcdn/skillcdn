# apps/server: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This workspace is the composition root: it wires ports to adapters and exposes the product over HTTP and the job queue.

- **Wiring here, logic elsewhere.** Domain rules belong in `@skillcdn/core`, SQL in `@skillcdn/db`, GitHub calls in `@skillcdn/github`. If a handler grows domain logic, move it down.
- **`src/config/` is the only reader of `process.env`** (lint enforces it). A new variable means: schema in the config module, an entry in `.env.example`, and a row in the table in `deploy/README.md`, all in the same change. Every tunable has a safe generic default; production values are never committed.
- **`api` is stateless.** No in-memory state that affects correctness, no sticky sessions, MCP transport in stateless mode. An in-process cache is an optimization only, bounded, and keyed per repo and commit, never per user.
- **Every handler runs in this order:** validate input with a schema, check permission, then do the work. Responses for private content are `Cache-Control: private, no-store`. Unknown and forbidden repos produce the same response.
- **Errors are mapped at the edge.** Never forward an upstream error body, a stack trace or a token-bearing URL to a client.
- **Jobs are idempotent and interruptible.** Deduplicate by `(repo, commit)`. Payloads are versioned and stay readable by the previous release. A job never assumes it runs exactly once.
- **Roles load their own weight.** Import role-specific heavy dependencies inside the role module so `api` does not pay for `worker`.
- **Shutdown is part of the feature.** Anything long-running registers with the shutdown path, and tests cover it.
- **Logging:** structured logger only. Include request id, account and repo. Never log tokens, authorization headers or file content.
- **No business logic.** Limits and capabilities come from the `Entitlements` port and usage goes to `UsageSink`; never branch on plan names.

## Gotchas

- Integration tests in one file share a database, and the system is built to reuse what it knows: a repository is its host id, a commit is indexed once, a body is stored once per hash, a default branch is cached. A test that needs fresh state gives `createFixtureHost` a variant and addresses that variant's commit explicitly, and adds files of its own when it needs something to be fetched.
- `snapshots.close()` aborts indexing and refuses new work; tests that only want to wait use `snapshots.idle()`.

- `pnpm dev` runs the compiled output. If types look stale across packages, the root `dev:tsc` watcher is not running.
