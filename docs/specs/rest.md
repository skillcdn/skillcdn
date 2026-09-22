# Spec: REST API

- Status: **Draft.** Version 1 serves the web UI; expect additions.
- Contracts (response schemas) live in `packages/core`; handlers live in `apps/server`. The web UI is the first client and uses nothing else.

The REST API shows a person what an agent gets from an address. It is anonymous and read-only, serves public repositories only, and answers from the same index and with the same rules as the [tools](tools.md): nothing here can reach outside the mounted `(repo, ref, path)`.

## Conventions

- Base path `/api/v1`. JSON in UTF-8. Changes within a version are additive.
- `<address>` is an address exactly as in the [address spec](address.md), for example `/api/v1/mounts/gh/acme/skills@v2/ads`. It is parsed from the raw path, so percent-escapes follow the address rules.
- Paths inside responses are relative to the mounted root, like paths in tool results.
- Responses are `cache-control: no-store` for now.
- A page on any origin may call the API from a browser: responses say `access-control-allow-origin: *`, preflight `OPTIONS` requests are answered, no credentials are used or accepted, and `x-request-id` and `retry-after` are readable by the page.
- Errors have one shape, shared with the MCP endpoint: `{ "error": { "code": "...", "message": "..." } }`.

| Status | `code` | When |
|---|---|---|
| 400 | `address.*` | The address does not parse. The code names the rule. |
| 400 | `request.invalid` | A query parameter is missing or malformed. |
| 404 | `mount.repo_not_found` | The repository does not exist or is not public. The two are indistinguishable. |
| 404 | `mount.ref_not_found` | The ref does not exist in the repository. |
| 403 | `mount.not_allowed` | The deployment does not serve this repository. |
| 503 | `mount.rate_limited`, `mount.unavailable` | The git host cannot be asked right now. `retry-after` is set when known. |
| 503 | `skill.unavailable` | The skill is indexed but its content cannot be read right now. |
| 404 | `skill.not_found`, `file.not_found` | Nothing by that name or at that path in the mount. |
| 409 | `skill.ambiguous` | Several skills share the name; `error.directories` lists them. |
| 413 | `file.too_large` | The file is over the readable size limit. |
| 415 | `file.not_text` | The file is not UTF-8 text. |

## Index state

Asking about an address starts indexing its commit, as connecting an MCP client does. The REST API never waits for it. Endpoints that need the index answer `200` with `"status": "indexing"` (ask again shortly) or `"status": "failed"` with an `errorCode` (retried automatically after a backoff) instead of their normal body, which has `"status": "ready"`.

## Endpoints

### `GET /api/v1/mounts/<address>`

What the address serves.

```json
{
  "address": "/gh/acme/skills@v2/ads",
  "repository": { "host": "gh", "owner": "Acme", "name": "skills", "defaultBranch": "main", "description": "Skills for every team" },
  "ref": "v2",
  "pinned": false,
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "path": "ads",
  "verified": false,
  "index": {
    "status": "ready",
    "truncated": false,
    "manifest": { "path": "SKILLCDN.md", "name": "Acme playbooks", "description": "..." },
    "skillCount": 2,
    "documentCount": 1,
    "skills": [{ "name": "ad-copy", "directory": "ad-copy", "description": "...", "warnings": [] }],
    "documents": [{ "path": "README.md", "title": "Ads", "summary": "..." }],
    "diagnostics": [{ "path": "broken/SKILL.md", "code": "missing_description", "message": "..." }]
  }
}
```

- `address` is the canonical form. `ref` is `null` for the default branch. `pinned` is true for a full commit hash.
- `repository.description` is what the host shows as the description of the repository, on one line, or `null`.
- `manifest` is what the repository's manifest says about the mount ([convention](skill-repo.md), "The repository manifest"), or `null` when there is none: `name` (`null` when the repository goes by the name its host gives it), `description`, and `path`, the manifest relative to the mount, or `null` when it lies above the mounted directory. With a manifest, the counts and the listings cover only what it declares.
- `skills` and `documents` list at most 200 entries each; the counts are complete. `documents` are the Markdown and JSON files that do not belong to a skill; a skill's own files are listed by the skills endpoint.
- `diagnostics` are the findings of the [convention parser](skill-repo.md) for the repository author: manifests that were skipped, and why. Only manifests inside the mounted path are listed.
- `truncated` is true when the repository was larger than the indexing limits.

### `GET /api/v1/find/<address>?query=&limit=`

The `find` tool. `query` is optional (at most 500 characters); `limit` is 1 to 25, default 10. Without a query the answer lists every skill (up to 100), then up to `limit` documents that do not belong to a skill, and `totals` says how many of each there are; with a query, `totals` is `null` and `limit` bounds the results.

```json
{ "status": "ready", "query": "blameless review", "items": [
  { "kind": "skill", "name": "incident-review", "directory": "skills/incident-review", "description": "..." },
  { "kind": "document", "path": "docs/getting-started.md", "title": "Getting started", "summary": "...", "skillDirectory": null },
  { "kind": "document", "path": "skills/incident-review/assets/timeline.json", "title": null, "summary": null, "skillDirectory": "skills/incident-review" }
], "totals": null }
```

`skillDirectory` names the skill a document belongs to, when it belongs to one inside the mount.

### `GET /api/v1/skills/<address>?name=`

The `get` tool: one skill by name or by directory.

```json
{ "status": "ready", "skill": {
  "name": "incident-review", "directory": "skills/incident-review", "description": "...",
  "license": "Apache-2.0", "compatibility": null, "allowedTools": null, "metadata": {},
  "body": "# Incident review\n...", "files": ["skills/incident-review/assets/timeline.json"],
  "filesTruncated": false, "warnings": [],
  "rules": { "path": "SKILLCDN.md", "body": "# Rules for every skill\n...", "truncated": false }
} }
```

`rules` is the body of the repository's manifest, which holds for every skill, or `null` when there is none; `path` is `null` when the manifest lies above the mounted directory, and `truncated` is true when the body was cut at the limit `get` applies.

### `GET /api/v1/files/<address>?path=&offset=&limit=`

The `read_file` tool: a page of a UTF-8 text file. `path` is relative to the mounted root; `offset` and `limit` are in characters (`limit` 1 to 100,000, default 40,000). It does not need the index.

```json
{ "kind": "file", "path": "docs/getting-started.md", "content": "...", "offset": 0, "nextOffset": null, "totalLength": 1234 }
```

When `path` names a directory (`.` is the mounted root), the answer is what it contains, subdirectories first, at most 200 entries:

```json
{ "kind": "directory", "path": "docs", "entries": [
  { "path": "docs/images", "kind": "directory", "size": null },
  { "path": "docs/getting-started.md", "kind": "file", "size": 1234 }
], "truncated": false }
```

### `GET /api/v1/featured`

The addresses the operator chose to show on the explorer's front page (`FEATURED_ADDRESSES`), each with what is known about it right now. Addresses that do not resolve are left out.

```json
{ "items": [
  { "address": "/gh/acme/skills", "repository": { "host": "gh", "owner": "Acme", "name": "skills", "defaultBranch": "main", "description": null },
    "status": "ready", "skillCount": 12, "skills": ["ad-copy", "incident-review"] }
] }
```

`skills` holds at most 5 names. There is deliberately no endpoint that lists every indexed repository: anyone can have any public repository indexed by asking for it once, so such a list needs a listing policy first.

## Open questions

- Caching: pinned addresses could be served as immutable.
- Rate limiting is left to whatever sits in front of the server, as for the MCP endpoint.
