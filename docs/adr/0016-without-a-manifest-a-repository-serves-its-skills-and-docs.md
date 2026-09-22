# ADR-0016: Without a manifest, a repository serves its skills and `docs`

- Status: Accepted; amends point 2 of ADR-0014
- Date: 2026-09-22

## Context

ADR-0014 made the manifest decide what a mount serves and left a repository without one as it was: every file but the hidden ones. The reference repository, served without a manifest, showed what that means. Its contributor guide, its agent instructions, its license, its package file and its check scripts were listed as documents next to the skills, and an agent's `find` returned them. A repository is a working tree, and most of it is for the people and the tools that maintain it. What is for an agent is the skills, and the documents someone put in a directory for it; `docs` is where the Agent Skills layout and nearly every repository keep those.

## Decision

1. **A repository without a manifest serves its skills and the documents in `docs` at its root**, and nothing else: not the root `README.md`, not other files at the root, not other directories. A manifest that does not name `documents` gets the same default, `docs` next to the manifest; `documents: []` serves no documents.
2. **The rest of the reading rules stand.** Hidden entries are never served; under a manifest only what it declares is; a manifest that cannot be read fails closed to the skills and itself.

## Consequences

- What an agent sees in a repository without a manifest is small and predictable: the skills, and `docs`. A repository whose documents live elsewhere, or that wants a name, a description or rules, adds the manifest and says so.
- A repository of plain documents, without a skill, is served when they are in `docs`; anywhere else it needs the manifest.
- The served set of a commit is decided when it is indexed, so the reading rules carry a version and an index built under older rules is rebuilt when it is next asked for (`packages/db`, `snapshots.index_version`). Without that, a deployment would keep serving what the earlier rules produced until the repository moved to a new commit.
