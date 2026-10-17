# ADR-0054: The reads are a package of their own, over an index-store port

- Status: Accepted
- Date: 2026-10-18
- Builds on [ADR-0045](0045-the-indexer-is-a-package-and-check-is-a-command.md) and [ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md).

## Context

The reads of a mount, a folder browsed, a search, a skill assembled and paged, a file read, and what the MCP skills extension lists and serves, lived in `apps/server`, written against the database package's queries and the snapshot service. The command is to answer the same reads from a directory, without a database ([ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md)), and a second implementation of those rules would drift from the first. What the reads need of a store turned out to be small: the served entries of the commit, a search over them, the diagnostics, and the bodies by hash. Everything else is logic over that list, which the server loaded whole for most reads already.

## Decision

1. **`packages/reader` (`@skillcdn/reader`) holds the reads:** `Reader`, over a `MountContext` and an index the caller answers (`ReaderDependencies.index`, which says the index of the mount's commit or that it is not ready), with `fetchBody` for a body the store does not hold. It depends on `core` and Node.js and nothing else, and is published like the other packages ([ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md)).
2. **`core` defines the port:** `IndexStore` (the entries, a search, the diagnostics), `ReadableIndex` (its id, the version of the reading rules, whether it is truncated, the license, the store and the bodies) and `IndexOutcome`. `db` implements it over PostgreSQL (`createIndexStore`); the reader package will hold the implementation over an index in memory, read from a directory.
3. **The questions the server asked in SQL are asked of the served entries in the reader**, with the same answers in the same order; what the database answers itself is the entries, the search and the diagnostics. The database's own query functions stay for what the server asks of a snapshot without the reader.
4. **The server composes:** `createMountReader` answers the index from the snapshot service and the database and fetches a missing body from the git host; its `Mount` extends `MountContext`.
5. **Dependency edges:** `server → db, github, indexer, reader → core` and `reader → core`. Nothing imports the server.

## Consequences

- One implementation of the reads, tested through the server against PostgreSQL and, from the next step, through the command against an index in memory; a change to a read changes both.
- The entries of a commit are loaded whole for every read, as the server already did for most; a cache bounded by index keeps it to one query per index per process.
- The package has no tests of its own yet: the server's integration tests cover it, and the command's tests will cover the memory index.
- Rejected: a second reader for the command (two sets of reading rules); the reader in `core` (it pages bytes and makes cursors, which is Node.js and I/O-shaped, where `core` is pure); PostgreSQL embedded in the command (an engine where none is needed); a port shaped like the SQL queries (thirteen questions to answer twice, where three suffice).
