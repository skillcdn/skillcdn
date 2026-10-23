# ADR-0068: A mount serves the last indexed commit while the newest is not ready

- Status: Accepted
- Date: 2026-10-23
- Builds on [ADR-0007](0007-snapshot-rows-coordinate-indexing.md) (the snapshot row of a commit is the source of truth for its index), [ADR-0034](0034-a-tool-result-is-the-text-written-for-the-model.md) (a tool result is the one text written for the model) and [ADR-0039](0039-an-address-serves-only-what-is-the-repositorys-own.md) (what an address serves).

## Context

A mount is answered from the index of the commit its address resolves to, and until that index is ready it is answered `indexing`, or `failed` with the reason. Two things make that the whole pack's state at once. A change of the reading rules sends the ready index of every commit back to pending the next time it is asked for, to be rebuilt, and a pack is gone from every client until its rebuild has run. And a commit the indexer cannot read, because of what it holds or because of a mistake in the rules, takes its ref down for as long as it is the newest, although the commit before it was served a moment ago and nothing of it changed.

The previous commit's index is in the database still, and so is the old index of a commit sent back for a rebuild: the entries of a snapshot are replaced in the one transaction that writes the new index, so a reader sees the old ones or the new ones, never a mixture. Nothing used them.

What a result may say about it was decided before the work started: context is dearer than the edge case, so no sentence is added to every result, and a workflow that must stay on one commit pins it, as the address grammar allows.

## Decision

1. **A moving ref is answered from the last commit of the same ref that has an index while its newest commit's index is not ready.** The ref cache remembers, when a ref moves away from a commit that has an index, that commit as the ref's previous one; while the newest commit is being indexed or failed to be, the previous commit's index answers. The same repository and the same ref only: no commit of another ref, and no commit the ref is not known to have been at. An address pinned to a commit asks for that commit and is answered `indexing` or `failed` as before.
2. **A commit sent back for a rebuild is answered from its index under the previous rules** until the new one is written, as long as those rules are not below the lowest the code can serve. The indexer exports that floor beside the version of the rules, `MIN_SERVABLE_INDEX_VERSION`, raised only when a version changes the entries in a way the reader of the current version cannot serve. The reader's caches key on the snapshot and the version, so the rebuilt index is read fresh.
3. **What is read names the commit it was read from, and the newest commit is named once.** The `Source` line of every result carries one clause more while another commit's index is served, `newest <commit> indexing` or `newest <commit> failed (<code>)`, and `being reindexed` or `reindexing failed (<code>)` for the same commit under newer rules; the connection instructions say the same in one sentence on connect. Nothing else is added to a result. The REST API answers `commit` as the commit answered from, and the `mounts` route carries `newest` beside it, `null` while the two are the same; the page of the address shows the same. Cursors bind to the index they came from, so a cursor of the previous commit's index is refused on the newest, as after any move of the ref.
4. **There is no bound on how long the previous commit is served.** Nothing served is the worst state a pack can be in; the failure keeps being retried on its schedule, and it stays visible in the page, the instructions and every `Source` line until the newest commit is indexed.
5. **The page the skills extension lists from such an index is kept as briefly as an empty one**, five seconds, so that a client asks again soon; the other cache fields are the ref's, as always.
6. **Whatever rule keeps indexes keeps, per ref, the last commit that has one.** Nothing deletes indexes yet; when something does (the `worker` of the roadmap), the previous commit of a ref is among what it keeps. Purging a repository removes everything of it, as before.

## Consequences

- A change of the reading rules no longer takes packs down: each commit is served from its old index until its new one is written, and the writer replaces the entries in one transaction.
- A commit that fails stays visible as failed, and the pack stays served from the commit before it. What the newest commit removed is served from the previous one until the newest is indexed: accepted, since the alternative is to serve nothing; a repository author who must take something down fixes what makes the commit fail, or deletes the content at the git host, which removes the repository's index with it.
- A mount's `commit` is no longer always the commit the address resolves to; everything that renders or compares commits reads it from the result, where it was already, and the `mounts` route says which is newest.
- The ref cache gains a column for the previous commit, written when the ref moves away from a commit that has an index.
- The command, serving a directory, hands the reader no substitute: its index is of the working tree as it is.
- Rejected: a notice in every result or a line that says to search again (context, see above); an upper bound on how long the previous commit is served (nothing served is worse); falling back to a commit of another ref (it would serve another ref's content under this address); serving an index below the floor (entries the code cannot read).
