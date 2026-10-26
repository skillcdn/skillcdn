# ADR-0073: A sweep puts the waiting embedding in order, and a worker sweeps first in its own process

- Status: Accepted
- Date: 2026-10-26
- Supersedes point 4 of [ADR-0072](0072-the-worker-embeds-the-packs-first-and-the-rest-when-asked.md) (the worker lets the embedding queue go at start); builds on its other points and on point 3 of [ADR-0064](0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md) (the jobs on pg-boss).

## Context

ADR-0072 ordered the embedding by the repository's rank. A job that waits keeps a job of the same slice out, so it had the worker let go of every embedding job that waits when it starts, and sweep: what waits is derived from the database, and a restart would queue it again in the order of the build that starts. That sweep went through the queue. A rollout runs the old and the new processes side by side for a while ([the rollout contract](../../deploy/README.md#rollout-contract)), and a worker of the build before, still taking jobs until it is stopped, may take the sweep the new worker sends and queue every served snapshot again in the order of its own build. The new worker then takes them in that order, and its hourly sweeps can add nothing, since each of those jobs keeps its slice's key: the order a deployment just rolled out reaches the queue only when every one of those jobs has run. The `api` and the worker of the build before go on queueing while they overlap, whatever the new worker lets go, and letting go of what waits drops a request by hand and a search's request as well.

## Decision

1. **A sweep puts what waits in the order of its build** before it queues anything. Every embedding job that waits under the configured key gets the priority this build gives it, a designation the first of all and the rest by the rank their repository has now where the sweep ranks it, in place, through the library's own edit of a job that waits (pg-boss `update`, which leaves a job that has started alone). A job of a repository the sweep does not rank, one that is no pack, keeps its place: the worker asks the rank again before it embeds. ADR-0072 rejected a change of a queued job's priority as a write to the library's tables, which this is not.
2. **The sweep does not queue a snapshot that has a slice waiting.** The slice goes on from where it starts; a first slice beside it would race it through the same bodies.
3. **A worker runs its first sweep in its own process when it starts**, before it takes a slice, never through the queue, where another worker could take it. The hourly sweep goes through the queue as before.
4. **The worker no longer lets the queue go at start.** A request by hand, or a search's request, that waits keeps its place.
5. **The slice after a slice carries the rank the worker found** for the backfill or an index, whatever the job before it was queued with.

## Consequences

- A worker that starts beside one of the build before has the queue in its order before it takes a slice. What the other processes queue while the two overlap is put in order by the next sweep, within the hour, and a slice the new worker takes of it carries the rank on.
- A repository the operator lists, or whose rank changes otherwise, moves up within the hour, not when its waiting job comes up.
- Each sweep reads the waiting jobs of the embedding queue, a few thousand at most. While a worker of an older build is still running, a sweep it takes orders the queue by its rules, and the next sweep of the newer build orders it again.
- Rejected: a version of the rules on every job, with the jobs of another version dropped (the build before knows no version, and dropping loses requests); letting the queue go at the first hourly sweep as well (it loses the same requests, an hour late); waiting until no other worker is heard from (the queue knows no workers, and a fixed delay is a guess); the priority in the singleton key, so that an older job keeps nothing out (two jobs of one slice, embedded twice where slices run side by side).
