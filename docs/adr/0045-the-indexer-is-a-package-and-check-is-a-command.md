# ADR-0045: The indexer is a package of its own, and `check` is a command

- Status: Accepted
- Date: 2026-10-09

## Context

The reading rules lived in `apps/server`, where the `check` role read a working tree with them ([ADR-0020](0020-a-check-role-reads-a-working-tree-with-the-indexer.md)). An author could run that role only from the image or from a checkout of this repository, and the first package to publish on npm is that command ([roadmap](../roadmap.md)): what an author runs before pushing must not drag the server, its database driver and its HTTP stack along. The types of an index were defined in `packages/db`, so moving the indexer out of the server alone would have made a command for authors depend on the database package. ADR-0020 rejected publishing the parser, because the served set is decided by more than the parser; what moves here is the whole of the reading rules.

## Decision

1. **`packages/indexer` (`@skillcdn/indexer`) holds the reading rules:** `buildSnapshotIndex`, `INDEX_VERSION`, the hashes, `checkDirectory`, and the limits with the `INDEX_*` variables they are read from. It depends on `core` and on Node.js, and on nothing else: no database, no git host of its own, no environment. The server indexes commits with it and reads the limits through it; `apps/server/src/indexer` keeps only the coordination of who indexes ([ADR-0007](0007-snapshot-rows-coordinate-indexing.md)).
2. **The types of an index move to `core`** (`IndexEntry`, `SnapshotIndex`, `SnapshotDiagnostic`, `SkillFrontMatter`, `StoredTranslation`): pure data, the contract between the indexer that produces an index and the database package that stores it. `db` and `indexer` both depend on `core` and never on each other.
3. **`packages/cli` (`@skillcdn/cli`) is the `skillcdn` command**, thin by design: arguments, the environment and exit codes. `skillcdn check [directory]` runs `checkDirectory` with the limits read from `INDEX_*` and exits with `0`, `1` or `2` as the role does, `64` for a usage error and `78` for limits it cannot read. The `check` role stays in the image and calls the same function.
4. **Dependency edges:** `server → db, github, indexer → core`, and `cli → indexer`. Nothing imports `cli`, and nothing imports `apps/server`.

## Consequences

- An author checks a repository with the command, under the exact rules a deployment applies. The fixture-based tests of the role stay in the server, next to its fixtures; what a working tree has that a git tree does not is tested next to the code that reads it.
- The limits have one definition: defaults, variables and bounds live in the indexer, and the server's configuration module reads them through it.
- `INDEX_VERSION` now changes in a package other workspaces consume; the server picks a bump up through the workspace, as before.
- Rejected: bundling the server's source into a command (a package reaching into another's source, against the boundaries); the server depending on `cli` for the indexer (a dependency pointing at a command); keeping the index types in `db` (a command for authors would install a database driver); a package for the parser alone (ADR-0020's reason stands).
