# ADR-0025: A skill on the wire is a plain Agent Skills skill, assembled from its sources

- Status: Accepted
- Date: 2026-09-26
- Amends ADR-0018: the `skillcdn` key stays in the source and leaves the wire. Applies the directory-license clause of ADR-0001 to `docs/specs`.

## Context

The skills extension hands a host the bytes of a `SKILL.md` together with the front matter it listed, and the host compares the two field by field ([ADR-0024](0024-skills-travel-through-the-mcp-skills-extension.md)). Other readers of the Agent Skills layout reject a front matter with keys they do not know, some of them by refusing the file. The rules a repository manifest declares and the files a skill includes are what make a skill from this format work, and both live outside the `SKILL.md`. What is served is bound to the listing by its digest, not to a git blob: a server may serve what it assembles, as long as it declares exactly that.

## Decision

1. **The wire form of a skill is assembled.** `load_skill` and `skills/get` serve the same text: the front matter of the source, re-serialized with every scalar quoted and without the `skillcdn` key; a labeled block that names the files and the commit the text was assembled from; the bodies of the repository manifests from the repository root to the nearest, each under its path; the skill's own body; and the files the skill includes, each under its path. Every other file of the skill is served as it is in the repository.
2. **Digests and sizes are computed over what is served**, at indexing time, and the index keeps the bytes of every served file, so that a read never differs from the listing.
3. **`skillcdn` stays in the source.** Authors keep declaring includes and translations there ([ADR-0018](0018-skillcdn-fields-in-skill-md-under-one-key.md)); the key is stripped on the wire, and `read_repo_file` returns the source as written.
4. **The extension lists a skill only when a host can hold it as a skill:** its directory is named after it (or it is the root skill), every one of its files can be served within the read limit, and it has at most 512 files and 16 MiB. Any other skill stays available through the tools, and `check` and the explorer say why it is not listed.
5. **The specification is licensed apart from the code.** `docs/specs` carries the Apache License 2.0, so that anyone may implement the format and the tools. The trademark policy allows everyone the file name `SKILLCDN.md`, the `skillcdn` front-matter key, and truthful statements of compatibility.

## Consequences

- A skill copied from the wire is complete and works in any reader of the layout, rules included; the block that names its sources keeps provenance visible.
- The wire form is not the git blob: the served digest changes when a rule above the skill changes, and the source `SKILL.md` alone still carries a key that strict readers reject. Authors who need the bare source to pass such a reader keep the key out of it, at the price of includes and translations. Moving those declarations into the manifest is a later decision.
- The index grows by the bytes it serves. A body that was text only becomes bytes with a text derived for search.
- Rejected: serving the git blob verbatim (a host would get a skill without the rules that make it usable, under a front matter other readers reject); a synthetic front-matter field for the rules (an unknown key again); moving includes and translations into the manifest now (it reverses ADR-0018 for authors before the wire form has proven itself).
