# Spec: tools exposed to the agent

- Status: **Draft.**
- Contracts (names, descriptions, input schemas, result shapes and text rendering) live in `packages/core`; handlers live in `apps/server`.

A mounted address exposes four read-only, idempotent tools. Actual folders organize discovery; names are labels, and exact repository-root paths identify content. [ADR-0022](../adr/0022-repository-paths-and-progressive-skill-loading.md) records this pre-alpha replacement of `find` and `get`.

## Inputs

| Tool | Argument | Rule |
|---|---|---|
| `browse` | `path` | Optional directory path. Omitted: the mounted directory. Lists immediate entries, not the entire subtree. |
| | `cursor` | Optional opaque continuation from the preceding page of this request. |
| | `limit` | Optional integer, 1 to 200. Default 50. |
| `search` | `query` | Required nonblank text, at most 500 characters. Use words in the original content's language, usually English. Display translations are not search aliases. |
| | `path` | Optional directory path restricting search to that subtree; omitted: the mounted directory. |
| | `cursor` | Optional continuation of the same search. |
| | `limit` | Optional integer, 1 to 25. Default 10, after folding supporting files under skills. |
| `get_skill` | `path` | Required exact path of a `SKILL.md`, such as `marketing/skills/ad-copy/SKILL.md`. A name or directory is not a skill identifier. |
| | `cursor` | Optional continuation of the same skill's context. |
| `read_file` | `path` | Required exact file path. Directories are browsed with `browse`. |
| | `offset` | Optional character offset. Default 0. |
| | `limit` | Optional number of characters, 1 to 100,000. Default 40,000. |

Paths always start at the repository root, including on a sub-path connection. No leading `/`, `.` or `..` segments, backslashes, control or invisible characters; no current-directory state. The empty directory path names the repository root and is valid only when it is inside the mount. For `/gh/acme/library/marketing`, the skill path remains `marketing/skills/ad-copy/SKILL.md`.

## Browse and search

`browse` shows immediate folders and eligible files with their canonical paths. Folder entries carry counts and identify a skill or a `SKILLCDN.md` when present. Manifest metadata adds a name and description to the real folder; it does not create an alias or hide path segments. Plain folders work without a manifest. Pages name their commit and provide `nextCursor` when more entries remain.

A skill entry's `path` names its `SKILL.md`; its `browsePath` names the containing directory for supporting files and nested skills. Opening a parent skill does not hide nested skills.

`search` matches words, not meaning. Any query word may match; relevance determines the order, with skill names and descriptions weighted above body text. Results retain relevance order across folders. The optional `path` is a scope filter, not a search term.

Search indexes original metadata and body text, excluding front-matter translation fields. All MCP discovery and skill context use the original name, description and instructions. The UI language never selects a skill translation for the agent. English is the recommended authoring default, while other original languages remain supported; a manifest's `language` helps the agent choose query words. `read_file` preserves exact source text, including translation declarations when present.

A skill's supporting files are folded under their owning skill before pagination. The skill occupies its best-ranked member's position, with up to five matching files and a count of the rest. This avoids duplicate skills on later pages or short pages caused by folding after the limit. Independently discoverable documents appear with their title and summary; linked-only references do not become independent search results ([format](skill-repo.md)).

Listings and searches expose whether more results exist and carry diagnostics for unreadable manifests. A partial index is identified as partial; pagination cannot recover files excluded by indexing limits.

## Loading a skill

`get_skill` resolves only its exact `SKILL.md` path. The result includes the canonical path, name, description, known front-matter fields, parser warnings, supporting-file paths and resolved Markdown reference paths. Two skills with the same name remain distinct.

The context arrives in this order:

1. Every applicable `SKILLCDN.md` body, from the repository root to the nearest manifest, each with its source path.
2. The skill's own body.
3. Files declared in `skillcdn.include`, in declaration order, each with its path.

Each page has at most 16 KiB (16,384 UTF-8 bytes) of context text. Metadata, source labels and the text and structured result envelopes add to the response size; this budget does not guarantee a fit within every client's token limit. A page may end inside a rule or file; the result marks the fragment, returns `complete: false` and supplies `nextCursor`. Continue `get_skill` with the same path and cursor until the context is complete before using the skill. Outer rules are not discarded to make inner rules fit. Missing or unreadable required content leaves `complete: false`; when another page cannot repair it, no continuation is supplied and the diagnostic explains why.

On a sub-path mount the rule chain still starts at the repository root. Ancestor rules outside the mount arrive through `get_skill` and its continuation. Their paths remain canonical, but `read_file` cannot use those paths to escape the mount. A link to another manifest does not add that manifest's rules; ancestry determines the rule chain.

Supporting-file summaries may be bounded. `browse` pages through the directory when more files are available. References identify files to read when needed; they are not automatically included in the skill's context unless `skillcdn.include` also declares them.

## Raw files

`read_file` returns UTF-8 text from an eligible file within the mount, with the path, character offset, total length and next offset. A page never splits a character. It does not prepend shared rules or turn a raw `SKILL.md` read into a skill load. Binary, oversized, unavailable and unknown files produce safe tool errors with a hint.

Reading is distinct from discovery: an explicitly linked file can be readable without being an independent search result. The [format](skill-repo.md) defines eligibility, hidden paths and reference expansion.

## Results and continuations

Results contain text for a model and corresponding structured data. Text identifies the repository, mount and commit, explains the next call, and labels repository content by its source. Tool output is data; nothing is executed by SkillCDN.

Cursors bind to the snapshot and reading-rule version, mount path, operation, scope and query or skill path. A cursor for another request, or for a snapshot that changed, is invalid: restart from the first page. A moving ref may resolve to a newer commit between calls; every result identifies its commit. Use an address pinned to a full commit hash when the entire workflow must stay on one commit ([address](address.md)).

A problem the model can correct is an error tool result, not a protocol error. Unknown and forbidden private repositories remain indistinguishable. Every call checks access, including cached reads.

## Connection and prompt

Connection instructions introduce the repository and mounted scope, give counts and a bounded overview of folders, and explain `browse`, `search`, `get_skill` and `read_file`. Manifest names, descriptions and language supply context where present. Instructions stay within 2,000 characters and point to browsing for the rest. They report indexing or manifest diagnostics instead of implying an incomplete catalog is complete.

The server info carries the manifest's name and description when available, otherwise the address and host description, and links to the address page. The description of `browse` also explains discovery for clients that do not show server instructions.

One MCP prompt, `use_skill`, takes a required `path` and starts loading the exact skill. If its context continues, the response directs the agent to `get_skill` with the continuation. Skills do not each add a prompt to the client's command menu. Documents are reached through tools, not an MCP resource catalog.

SkillCDN keeps no implicit selected team or role. Users can express their focus through their client's instructions or their request; folder descriptions help the agent choose a relevant scope.

## Indexing and trust

- Connecting starts indexing an unseen commit. `browse`, `search` and `get_skill` wait within a configurable budget, then return an indexing result if it is not ready. Indexing continues; failures retry after backoff.
- `read_file` does not wait. Until declarations and references are indexed, it exposes only content whose eligibility can be established conservatively.
- Unverified repositories carry a provenance notice: content comes from the repository author and applies to the user's requested task, not unrelated actions. The operator's temporary verification list is described by [ADR-0019](../adr/0019-the-operator-vouches-for-repositories-until-owners-can.md).
- Browser clients may call the endpoint from any origin: CORS permits `*` without credentials, as for [REST](rest.md).
- Future public-contract changes are additive unless an ADR explicitly defines a breaking transition.

## Open questions

- Whether unverified public repositories keep search once owner verification exists.
- Whether `read_file` should accept multiple paths for files needed only on some runs.
