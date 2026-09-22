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
  "repository": { "host": "gh", "owner": "Acme", "name": "skills", "defaultBranch": "main" },
  "ref": "v2",
  "pinned": false,
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "path": "ads",
  "verified": false,
  "index": {
    "status": "ready",
    "truncated": false,
    "skillCount": 2,
    "documentCount": 1,
    "skills": [{ "name": "ad-copy", "directory": "ad-copy", "description": "...", "warnings": [] }],
    "documents": [{ "path": "README.md", "title": "Ads", "summary": "..." }],
    "diagnostics": [{ "path": "broken/SKILL.md", "code": "missing_description", "message": "..." }]
  }
}
```

- `address` is the canonical form. `ref` is `null` for the default branch. `pinned` is true for a full commit hash.
- `skills` and `documents` list at most 200 entries each; the counts are complete.
- `diagnostics` are the findings of the [convention parser](skill-repo.md) for the repository author: manifests that were skipped, and why. Only manifests inside the mounted path are listed.
- `truncated` is true when the repository was larger than the indexing limits.

### `GET /api/v1/find/<address>?query=&limit=`

The `find` tool. `query` is optional (at most 500 characters; blank lists what is available, skills first); `limit` is 1 to 25, default 10.

```json
{ "status": "ready", "query": "blameless review", "items": [
  { "kind": "skill", "name": "incident-review", "directory": "skills/incident-review", "description": "..." },
  { "kind": "document", "path": "docs/getting-started.md", "title": "Getting started", "summary": "..." }
] }
```

### `GET /api/v1/skills/<address>?name=`

The `get` tool: one skill by name or by directory.

```json
{ "status": "ready", "skill": {
  "name": "incident-review", "directory": "skills/incident-review", "description": "...",
  "license": "Apache-2.0", "compatibility": null, "allowedTools": null, "metadata": {},
  "body": "# Incident review\n...", "files": ["skills/incident-review/assets/timeline.json"],
  "filesTruncated": false, "warnings": []
} }
```

### `GET /api/v1/files/<address>?path=&offset=&limit=`

The `read_file` tool: a page of a UTF-8 text file. `path` is relative to the mounted root; `offset` and `limit` are in characters (`limit` 1 to 100,000, default 40,000). It does not need the index.

```json
{ "path": "docs/getting-started.md", "content": "...", "offset": 0, "nextOffset": null, "totalLength": 1234 }
```

### `GET /api/v1/featured`

The addresses the operator chose to show on the explorer's front page (`FEATURED_ADDRESSES`), each with what is known about it right now. Addresses that do not resolve are left out.

```json
{ "items": [
  { "address": "/gh/acme/skills", "repository": { "host": "gh", "owner": "Acme", "name": "skills", "defaultBranch": "main" },
    "status": "ready", "skillCount": 12, "skills": ["ad-copy", "incident-review"] }
] }
```

`skills` holds at most 5 names. There is deliberately no endpoint that lists every indexed repository: anyone can have any public repository indexed by asking for it once, so such a list needs a listing policy first.

## Open questions

- Caching: pinned addresses could be served as immutable.
- Rate limiting is left to whatever sits in front of the server, as for the MCP endpoint.
