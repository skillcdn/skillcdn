# Spec: REST API

- Status: **Draft.** Version 1 serves the web UI.
- Response schemas live in `packages/core`; handlers live in `apps/server`. The web UI uses this API.

The API shows a person what an agent gets from an address. It is anonymous, read-only and limited to public repositories. It shares the index, canonical paths and reading rules of the [tools](tools.md). [ADR-0022](../adr/0022-repository-paths-and-progressive-skill-loading.md) explicitly changes the pre-alpha v1 path and skill contracts; future changes are additive unless another ADR defines a breaking transition.

## Conventions

- Base path `/api/v1`; UTF-8 JSON.
- `<address>` follows the [address spec](address.md), for example `/api/v1/mounts/gh/acme/library@v2/marketing`. Address percent-escapes are parsed from the raw path.
- Every content path is an actual repository-root path, including on sub-path connections. A skill's `path` ends in `SKILL.md`; its `directory` is the containing folder. Names do not identify skills.
- Ordinary reads and listings remain inside the mount. Applicable ancestor rules may arrive through skill-context continuation without permitting arbitrary reads above the mount.
- Responses use `cache-control: no-store` for now.
- CORS allows `*` without credentials, answers `OPTIONS`, and exposes `x-request-id` and `retry-after`.
- Errors have `{ "error": { "code": "...", "message": "..." } }`.

| Status | `code` | When |
|---|---|---|
| 400 | `address.*` | The address does not parse. |
| 400 | `request.invalid` | A query parameter or cursor is invalid, or its snapshot or request no longer matches. Restart pagination. |
| 404 | `mount.repo_not_found` | The repository does not exist or is not public; these are indistinguishable. |
| 404 | `mount.ref_not_found` | The ref does not exist in the repository. |
| 403 | `mount.not_allowed` | The deployment does not serve this repository. |
| 503 | `mount.rate_limited`, `mount.unavailable` | The git host cannot be asked now; `retry-after` is set when known. |
| 503 | `skill.unavailable` | Indexed skill content cannot be read now. |
| 404 | `skill.not_found`, `file.not_found` | No eligible content at that path inside the mount. |
| 413 | `file.too_large` | The file exceeds the readable size limit. |
| 415 | `file.not_text` | The file is not UTF-8 text. |

## Index state and paging

Resolving an address starts indexing. REST never waits: endpoints needing the index answer `200` with `status: "indexing"`, or `status: "failed"` and `errorCode`, instead of their usual `status: "ready"` result. Failed indexing retries after backoff.

Paged results identify their commit and return `nextCursor`, or `null` when the page is last. Cursors bind to the snapshot and reading-rule version, mount, operation and request parameters. They cannot be reused with another path or query. If a moving ref changes, restart from the first page; pin a full commit hash for a stable workflow. An index marked `truncated` is partial independently of pagination.

## Endpoints

### `GET /api/v1/mounts/<address>`

Repository identity and a bounded overview of the mount:

| Field | Meaning |
|---|---|
| `address` | Canonical address. |
| `repository` | Host, owner, name, default branch and host description. |
| `ref`, `pinned`, `commit`, `path` | Requested ref (`null` for default), whether it is a full commit hash, resolved commit, and mounted repository-root directory. |
| `verified` | Whether the operator or, later, the owner vouches for the repository ([tools](tools.md)). |
| `index` | State, or a ready overview with manifest metadata, skill/document counts, bounded listings and diagnostics. |

The overview's manifest carries its own canonical `path`, `name`, `description`, `language` and `translations`, or is absent when no applicable manifest exists. An ancestor manifest's path remains its actual repository path even if ordinary file reading cannot reach it from this mount. Names, descriptions and translations belong to their declaring manifest; language inherits from the nearest ancestor that declares it.

Skill listings expose exact `path`, `directory`, `name`, `description`, warnings and translations. Document listings expose canonical path, title and summary. Overview lists are bounded; clients use `browse` and `find` continuations to explore further. Counts cover eligible content, not every file in the git tree. Diagnostics explain unreadable manifests, and `truncated` identifies indexing limits.

### `GET /api/v1/browse/<address>?path=&cursor=&limit=`

The `browse` tool's immediate-folder view. `path` is an optional canonical directory (default: mounted directory); `limit` is 1 to 200, default 50. `cursor` continues the same listing.

Entries preserve the real folder tree, name their canonical paths, distinguish files and directories, and identify skill folders and manifest metadata when available. Counts help a client choose a subtree without loading every skill. A manifest adds context to its folder; it creates no shortened path or alias. The response carries diagnostics, commit and `nextCursor`.

### `GET /api/v1/find/<address>?query=&path=&cursor=&limit=`

The `search` tool's ranked search. `query` is nonblank text of at most 500 characters; `path` restricts the search subtree, defaulting to the mount. `limit` is 1 to 25, default 10, and bounds final results after folding. Use `browse` for directory discovery.

A skill result carries its exact `path`, `directory`, name, description and translations. Matching supporting files are folded into the owning skill before pagination, with up to five matching file summaries and `moreFiles` for the rest. A skill occupies its best-ranked member's position, even when only a supporting file matched. Independent document results have canonical path, title and summary. Results remain in relevance order across folders; linked-only references are not independent search results.

The response carries the query, result items, diagnostics, resolved `commit` and `nextCursor`.

### `GET /api/v1/skills/<address>?path=&cursor=`

The `get_skill` tool. `path` is required and is an exact canonical `SKILL.md` path. `cursor` continues that skill's context; names and directory aliases are not the canonical API.

The ready response's `skill` contains:

- `path`, `directory`, `name`, `description`, known front-matter fields, warnings and translations.
- `ruleChain`: applicable manifest bodies in repository-root-to-nearest order, with canonical source paths and fragment information.
- `body`: the skill-body content on this page.
- Supporting-file paths, included-file information and canonical `references` for optional reads.
- `complete` and `nextCursor`, indicating whether the context requires another call.

Context text is bounded to 16 KiB of UTF-8 per page: root-to-nearest rules first, then the skill body, then declared include files. Metadata and response structure add to that size. A page may contain only part of one rule or file and identifies the fragment. Continue until complete before treating the skill as loaded. Missing required content leaves `complete: false` with a diagnostic; `nextCursor` is absent when pagination cannot repair the failure. Ancestor rules above the mount are delivered through these pages; their paths do not become general file-read permissions. Translations are for the page's visitor, not alternate skill identifiers or search aliases.

### `GET /api/v1/files/<address>?path=&offset=&limit=`

The `read_file` tool. `path` is a canonical file path inside the mount. `offset` and `limit` are character counts (`limit` 1 to 100,000, default 40,000). Reads do not wait for indexing; eligibility is conservative until the index is ready.

```json
{ "kind": "file", "path": "marketing/docs/guide.md", "content": "...", "offset": 0, "nextOffset": null, "totalLength": 1234 }
```

A file page never splits a character. Use the browse endpoint for directories. Raw files do not add inherited rules or stand in for loading a skill.

### `GET /api/v1/featured`

The addresses the operator selects for the explorer (`FEATURED_ADDRESSES`), with their repository metadata, manifest introduction when available, index status, skill count and a few skill names. Unresolvable addresses are omitted. There is no public enumeration of every indexed repository: asking for an address alone does not opt its author into a catalog.

## Open questions

- Pinned addresses could support immutable caching.
- Rate limiting is left to the layer in front of the server, as for MCP.
