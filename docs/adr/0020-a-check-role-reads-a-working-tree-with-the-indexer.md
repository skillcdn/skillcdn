# ADR-0020: A `check` role reads a working tree with the indexer

- Status: Accepted
- Date: 2026-09-23

## Context

A `SKILL.md` whose front-matter YAML cannot be parsed is skipped, and the first real repository lost its only skill to a colon in the description: the mount served "0 skills", and nothing said why until the page of the address was opened. The reference repository validates itself with a script of its own, which re-implements a subset of the reading rules and drifts from them. An author needs the indexer's own verdict before pushing, and the indexer needs a repository on a git host and a database.

## Decision

1. **The image has a `check` role** next to `api`, `worker` and `migrate`: `node dist/main.js check [directory]`. It reads a working tree as the indexer reads a commit, with the same parsers, the same limits and the same served set, through an in-memory git host and blob store, and prints what an agent would get: the manifest, the skills with their files and warnings, the documents, what is not served, the manifests that could not be read with the indexer's reasons, and the instructions a client is told on connect. It exits with `1` when a manifest cannot be read, so a push can be gated on it.
2. It needs no database and no git host, reads only the `INDEX_*` limits from the environment, and executes nothing from the directory. Hidden entries, `node_modules` and symbolic links are left out, as they are absent from a git tree or never served.
3. **The indexer reports, never drops in silence.** Whatever it skips is in the diagnostics of the index, and every surface an agent or an author looks at shows them: the server instructions, `find`, `get` for a name that is not served, the REST API and the page of the address ([specs/tools.md](../specs/tools.md)).

## Consequences

- One parser, one verdict: a repository that passes `check` is served as `check` showed it. The reference repository's own script can shrink to what is specific to that repository.
- The role runs anywhere the image runs, and from a checkout of this repository; it does not need a published image to be useful to the maintainers.
- Rejected: an HTTP endpoint that validates a posted manifest (one file at a time, no served set, and a CI that depends on the network); publishing the parser as a package (nothing is published yet, and the served set is decided by more than the parser).
