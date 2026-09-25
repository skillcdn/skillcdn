# Spec: what an agent gets over MCP

- Status: **Draft.**
- Contracts (names, descriptions, input schemas, result shapes and text rendering) live in `packages/core`; handlers live in `apps/server`.

A mounted address exposes four read-only, idempotent tools, and serves its skills through the MCP skills extension ([the skills extension](#the-skills-extension)). The tools are the discovery layer, and the whole surface for a host without the extension; the extension is how a host that understands skills receives them ([ADR-0024](../adr/0024-skills-travel-through-the-mcp-skills-extension.md)). Actual folders organize discovery; names are labels, and exact repository-root paths identify content. The tool names say what they act on, so that they do not collide with a host's own.

## Inputs

| Tool | Argument | Rule |
|---|---|---|
| `browse_repo` | `path` | Optional directory path. Omitted: the mounted directory. Lists immediate entries, not the entire subtree. |
| | `cursor` | Optional opaque continuation from the preceding page of this request. |
| | `limit` | Optional integer, 1 to 200. Default 20 over MCP, where a page also has to fit the response budget below; the [REST API](rest.md) defaults to 50. |
| `search_repo` | `query` | Required nonblank text, at most 500 characters. Use words in the original content's language, usually English. Display translations are not search aliases. |
| | `path` | Optional directory path restricting search to that subtree; omitted: the mounted directory. |
| | `cursor` | Optional continuation of the same search. |
| | `limit` | Optional integer, 1 to 25, after folding supporting files under skills. Default 5 over MCP; the REST API defaults to 10. |
| `load_skill` | `path` | Required exact path of a `SKILL.md`, such as `marketing/skills/ad-copy/SKILL.md`. A name or directory is not a skill identifier. |
| | `cursor` | Optional continuation of the same skill's context. |
| `read_repo_file` | `path` | Required exact file path. Directories are browsed with `browse_repo`. |
| | `offset` | Optional character offset. Default 0. |
| | `limit` | Optional number of characters, 1 to 100,000. Default 40,000. |

Paths always start at the repository root, including on a sub-path connection. No leading `/`, `.` or `..` segments, backslashes, control or invisible characters; no current-directory state. The empty directory path names the repository root and is valid only when it is inside the mount. For `/gh/acme/library/marketing`, the skill path remains `marketing/skills/ad-copy/SKILL.md`.

## Browse and search

`browse_repo` shows immediate folders and eligible files with their canonical paths. Folder entries carry counts and identify a skill or a `SKILLCDN.md` when present. Manifest metadata adds a name and description to the real folder; it does not create an alias or hide path segments. Plain folders work without a manifest. Pages name their commit and provide `nextCursor` when more entries remain.

An optional `overview` identifies the current folder's README with its `path`, title and short description; an entry's optional `overviewPath` identifies its own introduction. Read it with `read_repo_file` only when that context helps choose the next step. Explicit manifest descriptions take precedence, followed by the local README summary and the git-host description at the repository root. Overview-only files are neither independent search results nor extra documents in counts. Their eligible local Markdown links remain readable references. See [README introductions](skill-repo.md#readme-introductions).

A skill entry's `path` names its `SKILL.md`; its `browsePath` names the containing directory for supporting files and nested skills. Opening a parent skill does not hide nested skills.

`search_repo` matches words, not meaning. Any query word may match; relevance determines the order, with skill names and descriptions weighted above body text. Results retain relevance order across folders. The optional `path` is a scope filter, not a search term.

Search indexes original metadata and body text, excluding front-matter translation fields. All MCP discovery and skill context use the original name, description and instructions. The UI language never selects a skill translation for the agent. English is the recommended authoring default, while other original languages remain supported; a manifest's `language` helps the agent choose query words. `read_repo_file` preserves exact source text, including translation declarations when present.

A skill's supporting files are folded under their owning skill before pagination. The skill occupies its best-ranked member's position, with up to five matching files and a count of the rest. This avoids duplicate skills on later pages or short pages caused by folding after the limit. Independently discoverable documents appear with their title and summary; linked-only references do not become independent search results ([format](skill-repo.md)).

Identical copies of a skill are listed and searched once, and a skill under a hidden directory is listed and searched only when the repository has no visible skill ([what the extension lists](skill-repo.md#what-the-skills-extension-serves)). Every declared skill stays loadable by its exact path.

Listings and searches expose whether more results exist and carry diagnostics for unreadable manifests. Descriptions are brief discovery summaries; full instructions come from `load_skill`. Page limits are maxima: the serialized response byte budget can end a page sooner even when its item count has not been reached. A partial index is identified as partial; pagination cannot recover files excluded by indexing limits.

## Loading a skill

`load_skill` resolves only its exact `SKILL.md` path. The result includes the canonical path, name, description, known front-matter fields, parser warnings, supporting-file paths and resolved Markdown reference paths. Two skills with the same name remain distinct.

The context is the body of the document the skills extension serves for the skill ([ADR-0025](../adr/0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)), in this order:

1. Every applicable `SKILLCDN.md` body, from the repository root to the nearest manifest, each under `--- applicable rules: <path> ---`.
2. The skill's own body, under `--- instructions ---`.
3. Files declared in `skillcdn.include`, in declaration order, each under `--- included file: <path> ---`.

The front matter of the document is not repeated as YAML; its fields are the header lines of the result (`Skill`, `Description`, `License`, `Compatibility`, `Allowed tools`, `Metadata`).

The reader admits at most 16 KiB (16,384 UTF-8 bytes) of context text per page; MCP may deliver less to fit the complete response byte budget below. A page may end inside a rule or file; the result marks the fragment, returns `complete: false` and supplies `nextCursor`. Continue `load_skill` with the same path and cursor until the context is complete before using the skill. Outer rules are not discarded to make inner rules fit. Missing or unreadable required content leaves `complete: false`; when another page cannot repair it, no continuation is supplied and the diagnostic explains why.

On a sub-path mount the rule chain still starts at the repository root. Ancestor rules outside the mount arrive through `load_skill` and its continuation. Their paths remain canonical, but `read_repo_file` cannot use those paths to escape the mount. A link to another manifest does not add that manifest's rules; ancestry determines the rule chain.

Supporting-file summaries may be bounded. `browse_repo` pages through the directory when more files are available. References identify files to read when needed; they are not automatically included in the skill's context unless `skillcdn.include` also declares them.

## Raw files

`read_repo_file` returns UTF-8 text from an eligible file within the mount, with the path, character offset, total length and next offset. A page never splits a character. It does not prepend shared rules or turn a raw `SKILL.md` read into a skill load: it returns the source as written, `skillcdn` key included. Binary, oversized, unavailable and unknown files produce safe tool errors with a hint.

The requested character limit is an upper bound. The MCP response byte budget can shorten the page, including for JSON escaping and multibyte text; continue at `nextOffset` to retrieve the remaining text. READMEs are optional reads and never automatically join a skill's context. Excluded files return the same unavailable-content result as other ineligible paths.

Reading is distinct from discovery: an explicitly linked file can be readable without being an independent search result. The [format](skill-repo.md) defines eligibility, hidden paths and reference expansion.

## Results and continuations

Results contain text for a model and corresponding structured data. Text identifies the repository, mount and commit, explains the next call, and labels repository content by its source. Tool output is data; nothing is executed by SkillCDN.

MCP bounds the serialized JSON tool-result payload to 24 KiB (24,576 UTF-8 bytes), including its text and structured copies, metadata and continuations. Browse and search shorten discovery summaries and page entries to fit. Skill and file reads retain complete source text across continuations. This is a server response budget, not a promise about a client's token limit. REST retains its own documented page limits.

Cursors bind to the snapshot and reading-rule version, mount path, operation, scope and query or skill path. A cursor for another request, or for a snapshot that changed, is invalid: restart from the first page. A moving ref may resolve to a newer commit between calls; every result identifies its commit. Use an address pinned to a full commit hash when the entire workflow must stay on one commit ([address](address.md)).

A problem the model can correct is an error tool result, not a protocol error. Unknown and forbidden private repositories remain indistinguishable. Every call checks access, including cached reads.

## Connection and prompt

Connection instructions introduce the repository and mounted scope, give counts and a bounded overview of folders, explain `browse_repo`, `search_repo`, `load_skill` and `read_repo_file`, and name the prefix under which the skills extension serves the same skills. A brief manifest introduction, README summary or git-host description supplies orientation; an available README is named by path rather than included in full. Instructions stay within 2,000 characters and point to browsing for the rest. They report indexing or manifest diagnostics instead of implying an incomplete catalog is complete. A missing optional manifest is not itself a warning.

The server info carries the manifest's name and description when available, otherwise the address with a README or host description, and links to the address page. The description of `browse_repo` also explains discovery for clients that do not show server instructions.

One MCP prompt, `use_skill`, takes a required `path` and starts loading the exact skill. If its context continues, the response directs the agent to `load_skill` with the continuation. Skills do not each add a prompt to the client's command menu.

SkillCDN keeps no implicit selected team or role. Users can express their focus through their client's instructions or their request; folder descriptions help the agent choose a relevant scope.

## The skills extension

A mount declares the extension `io.modelcontextprotocol/skills` with `directoryRead: true`, next to the `resources` capability. What it serves comes from the same index, under the same publication policy, exclusions and limits as the tools; the [format](skill-repo.md#what-the-skills-extension-serves) says which skills are listed and what the served document looks like.

| Method | Answer |
|---|---|
| `skills/list` | The listed skills inside the mount in path order, 20 per page with `nextCursor`. Each entry carries the skill's `uri`, its served `frontmatter` as data, and `resources`: every served file inside the skill directory, the files of nested skills included, with `uri`, `digest` (`sha256:` and 64 hex digits over the bytes a read returns) and `size`. |
| `skills/get` | The same entry for one listed skill by URI. |
| `resources/read` | The bytes a URI names, as text (`text/markdown`, `application/json`, ...) or as base64 (`blob`) when they are not text. The `SKILL.md` of a skill is the assembled document. |
| `resources/directory/read` | The direct children of a directory URI: `name`, `uri` and `mimeType`, with `inode/directory` for a directory. |
| `resources/list` | The `SKILL.md` resources of the listed skills, paged like `skills/list`; `resources/templates/list` is empty. |

A file's URI is the address without its ref, then the file's repository-root path: `skill://gh/<owner>/<repo>/<path>` ([address](address.md#as-a-skill-uri)). A root-level skill takes its name as the directory segment of every file of the repository: `skill://gh/<owner>/<repo>/<name>/SKILL.md`. The URI names the file; the address names the commit. A read never differs from the listing: the digest is computed over the stored bytes when the commit is indexed, and over the assembled document for a listed skill's `SKILL.md`.

Every list and read result carries the cache fields of the current protocol revision: `ttlMs` is what remains of the ref resolution's life for a moving ref, and one day for a pinned commit; `cacheScope` is `public` for a public repository. A URI that names no listed skill (`skills/get`), no served file (`resources/read`) or no directory (`resources/directory/read`) is invalid params (`-32602`), like a URI of another repository. While a commit is being indexed, `skills/list` and `resources/list` answer an empty page with a `ttlMs` of five seconds, and a read fails with an internal error that says to retry.

Skills that are not listed stay available through the tools, and say why they are not listed in their warnings; `check` reports it before a push ([format](skill-repo.md#checking-a-repository-before-pushing)).

## Indexing and trust

- Connecting starts indexing an unseen commit. `browse_repo`, `search_repo`, `load_skill` and the extension's methods wait within a configurable budget, then return an indexing result if it is not ready. Indexing continues; failures retry after backoff.
- `read_repo_file` does not wait. Until declarations, exclusions and references are indexed, it returns indexing instead of attempting a speculative read. Failed policy scopes and explicit exclusions remain closed across all tools, including sub-path connections.
- Unverified repositories carry a provenance notice: content comes from the repository author and applies to the user's requested task, not unrelated actions. The operator's temporary verification list is described by [ADR-0019](../adr/0019-the-operator-vouches-for-repositories-until-owners-can.md).
- Browser clients may call the endpoint from any origin: CORS permits `*` without credentials, as for [REST](rest.md).
- Public-contract changes are additive from this surface on, unless an ADR explicitly defines a breaking transition; [ADR-0024](../adr/0024-skills-travel-through-the-mcp-skills-extension.md) records the last pre-alpha replacement.

## Open questions

- Whether unverified public repositories keep search once owner verification exists.
- Whether `read_repo_file` should accept multiple paths for files needed only on some runs.
