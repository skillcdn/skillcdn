# ADR-0007: Snapshot rows coordinate indexing; the api role indexes lazily

- Status: Accepted
- Date: 2026-09-21

## Context

The first request for a commit nobody has seen must produce an index, several `api` replicas may receive that request at the same moment, and any process may be stopped at any time. The `worker` role and the job queue do not exist yet, and the smallest self-hosted install may never run a separate worker.

## Decision

The `snapshots` row for a `(repository, commit)` is the single source of truth for indexing. Whoever wants to index claims the row with one atomic update that succeeds for a pending row, for a row whose lease expired, and for a failed row whose retry time has passed. The holder renews its lease while it works, writes the index and the `ready` status in one transaction, records failures with a backoff, and hands the row back on shutdown.

Until the `worker` role exists, the `api` role does the claiming itself: connecting to an address starts indexing in the background, bounded per process, and a tool call waits on the row for a configurable budget before it answers that indexing is still running. File bodies are fetched by content hash, so a new commit only fetches what changed.

## Consequences

- Correct with any number of replicas and with crashes: exactly one process indexes a commit at a time, and an abandoned claim is picked up after its lease.
- Requests never depend on in-process state. A replica that did not start the indexing waits on the same row as the one that did.
- When the queue arrives, a job replaces the in-process claimant. The row, the lease and the transaction stay as they are, so the two can coexist during a rollout.
- The `api` role does background work for now, which competes with request handling. The per-process bound keeps that small; moving indexing to `worker` removes it.
- Index entries are written once per commit and never updated, which is what lets pinned content be cached without invalidation.
- Rejected: indexing inside the request (unbounded latency and client timeouts). Rejected: in-memory coordination (wrong with more than one replica). Rejected: introducing the job queue first (it delays the first end-to-end path and the row would still be needed for readers).
