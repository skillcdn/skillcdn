# packages/indexer: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is the reading rules: what a deployment serves of a commit is decided here, and `check` must agree with it byte for byte.

- **One parser, one verdict.** `checkDirectory` reads a working tree through `buildSnapshotIndex` itself, never through a copy of its rules. Whatever the indexer skips goes into the diagnostics; nothing is dropped in silence (ADR-0020).
- **Repository content is data.** Nothing from a tree is executed, imported or evaluated; symbolic links and submodules are not followed. Every limit turns "too much" into a partial index that says so, never into a failure.
- **`INDEX_VERSION` moves with the rules.** A change that would make an index come out differently (what is served, what is searched, how a document is summarized) bumps it in the same commit. Without the bump, a deployment keeps serving what the old rules produced.
- **No environment, no network, no database.** The git host, the blob store and the limits come in as arguments. `readIndexLimits` reads a record it is handed; the caller decides what that record is.
- **The index types live in `core`.** `IndexEntry` and its neighbours are the contract with the database package; a new field is added there, and `db` stores it.
