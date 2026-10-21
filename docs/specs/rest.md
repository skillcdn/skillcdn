# Spec: REST API

- Status: **Draft.** Version 1 serves the web UI, the `skillcdn` command and any program that reads a pack.
- Response schemas live in `packages/core`, the routes of an address in `packages/serve` and the client in `packages/client` ([ADR-0056](../adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md), [ADR-0057](../adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)); `apps/server` composes them with the deployment's own routes.

The API shows a person what an agent gets from an address, and gives a program the same ([serving an agent from a program](#serving-an-agent-from-a-program)). Without a credential it is anonymous, read-only and limited to public repositories; on a deployment where people sign in, a request that carries the session cookie of the deployment's own pages, or a token of this deployment ([authorization](#authorization)), is answered for that person, private repositories they can see included ([permissions](permissions.md)), and a few routes under [People](#people) belong to whoever is signed in. It shares the index, canonical paths and reading rules of the [tools](tools.md). [ADR-0022](../adr/0022-repository-paths-and-progressive-skill-loading.md) explicitly changed the pre-alpha v1 path and skill contracts, and [ADR-0024](../adr/0024-skills-travel-through-the-mcp-skills-extension.md) records the last such replacement; from its surface on, changes are additive unless an ADR defines a breaking transition.

## Conventions

- Base path `/api/v1`; UTF-8 JSON.
- `<address>` follows the [address spec](address.md), for example `/api/v1/mounts/gh/acme/library@v2/marketing`. Address percent-escapes are parsed from the raw path.
- Every content path is an actual repository-root path, including on sub-path connections. A skill's `path` ends in `SKILL.md`; its `directory` is the containing folder. Names do not identify skills.
- Ordinary reads and listings remain inside the mount. Applicable ancestor rules may arrive through skill-context continuation without permitting arbitrary reads above the mount.
- Responses use `cache-control: no-store` for now. A read of a public address pinned to a full commit hash never changes and is to be answered as immutable; a private read stays `no-store`, since a shared cache would answer it without the permission check.
- Limiting requests per client is the job of whatever sits in front of the server, as for MCP.
- CORS allows `*` without credentials, answers `OPTIONS`, allows the `authorization` request header, and exposes `x-request-id`, `retry-after` and `www-authenticate`. Without credentials means another origin's page never sends the session cookie: only the deployment's own pages read what is a person's through it; a page elsewhere presents a token ([authorization](#authorization)).
- Errors have `{ "error": { "code": "...", "message": "..." } }`.

| Status | `code` | When |
|---|---|---|
| 400 | `address.*` | The address does not parse. |
| 400 | `request.invalid` | A query parameter or cursor is invalid, or its snapshot or request no longer matches. Restart pagination. |
| 404 | `mount.repo_not_found` | The repository does not exist, or the caller may not see it; these are indistinguishable. |
| 404 | `mount.ref_not_found` | The ref does not exist in the repository. |
| 403 | `mount.not_allowed` | The deployment does not serve this repository. |
| 503 | `mount.rate_limited`, `mount.unavailable` | The git host cannot be asked now; `retry-after` is set when known. |
| 503 | `skill.unavailable` | Indexed skill content cannot be read now. |
| 503 | `index.indexing`, `index.failed` | A file read cannot establish the publication policy until indexing is ready. Retry later. |
| 404 | `skill.not_found`, `file.not_found` | No eligible content at that path inside the mount. |
| 409 | `skill.ambiguous` | More than one skill answers to the request; the response lists the `directories` to choose from. |
| 413 | `file.too_large` | The file exceeds the readable size limit. |
| 415 | `file.not_text` | The file is not UTF-8 text. |
| 403 | `file.not_served` | The license of the file's skill or repository allows a description, not a copy ([licenses](skill-repo.md#licenses)); `sourceUrl` links to the file at its host. |
| 404 | `legal.not_found` | The page of the deployment's own has not been written. |
| 400 | `owner.invalid` | The path after `/owners` is not `/gh/<owner>`. |
| 404 | `owner.not_found` | The git host shows no account by that name. |
| 401 | `auth.required` | The route is for whoever is signed in, and nobody is. |
| 401 | `auth.invalid_token` | The token presented is no good at this address, which is not public ([authorization](#authorization)); `www-authenticate` names the address's protected resource metadata. |
| 403 | `auth.forbidden_origin` | A request that changes something did not come from the deployment's own pages. |
| 404 | `grant.not_found` | The person has no such grant. |
| 400 | `oauth.*` | An authorization request that is malformed or has expired; the code after the dot is the OAuth error. |
| 400 | `connect.invalid` | A command asking to connect named no repository or nothing it calls itself, or an answer to one is not readable ([connecting](permissions.md#a-command-connects-with-a-code)). |
| 404 | `connect.not_found` | No command waits under the code or the secret: it was declined, claimed or is past its time. |
| 503 | `connect.busy` | The deployment holds as many connection requests as it will; `retry-after` is set. |

## Index state and paging

Resolving an address starts indexing. REST never waits: endpoints needing the index answer `200` with `status: "indexing"`, or `status: "failed"` and `errorCode`, instead of their usual `status: "ready"` result. Failed indexing retries after backoff.

Paged results identify their commit and return `nextCursor`, or `null` when the page is last. Cursors bind to the snapshot and reading-rule version, mount, operation and request parameters. They cannot be reused with another path or query. If a moving ref changes, restart from the first page; pin a full commit hash for a stable workflow. An index marked `truncated` is partial independently of pagination.

## Authorization

A public address needs no credential, and what is served does not depend on who asks ([permissions](permissions.md#the-model)). On a deployment where people sign in, the routes that read an address, `mounts`, `browse`, `find`, `skills` and `files`, answer for a person in one of two ways ([ADR-0052](../adr/0052-the-rest-api-takes-the-tokens-the-mcp-endpoint-takes.md)):

- **A session**: the cookie of the deployment's own pages, which a browser sends by itself.
- **A token of this deployment**, in the `authorization` header with the `Bearer` scheme: an access token a person's app received from the authorization server, good at the one canonical address it was issued for, ref and path included ([tokens](permissions.md#tokens)), or a repository token a person made for an agent with nobody to sign in, good at every address of that one repository ([repository tokens](permissions.md#tokens-for-agents-with-nobody-to-sign-in)). A token presented wins over a session sent with the same request. A header that is not a bearer credential is a credential that is no good.

The answers are those of the MCP endpoint ([permissions](permissions.md#mcp-authorization-is-optional)), with one difference: a request without any credential for anything that is not public is `404` here, never a challenge. The REST API has no discovery step: a program that runs against it is given its token by a person, and the pages read `404` as a repository that may be private, and offer to sign in.

| Request to an address | Answer |
|---|---|
| No credential, public repository | Served, as always. |
| No credential, anything else | `404 mount.repo_not_found`. |
| A valid token, a repository its person can see | Served, with `visibility: "private"`; the answer is that person's, and nothing between the server and the program may keep it. |
| A valid token, anything else that is not public | `404 mount.repo_not_found`: a repository the person cannot see and a name that is nothing are the same. |
| A token that is unknown, expired, revoked, malformed, issued for another address or made for another repository | At a public address: served, as to anyone. Anywhere else: `401 auth.invalid_token`, with the address's [challenge](permissions.md#the-challenge) in `www-authenticate` and `error="invalid_token"`, so that a program is told its credential is no good, and nothing else. |
| A valid token whose person the git host no longer vouches for | The same `401`: the person signs in again and makes the token again. |

Every request that reads something not public checks the person's access with the git host within the staleness bound, continuations and file reads included ([the permission check](permissions.md#the-permission-check)); a token says who made it, never what they may see. The routes under [People](#people) and the pages know a person by their session only: a token reads its repository and does nothing else as its person. On a deployment where nobody signs in, a token means nothing and anything not public is `404`.

## Endpoints

### `GET /api/v1/mounts/<address>`

Repository identity and a bounded overview of the mount:

| Field | Meaning |
|---|---|
| `address` | Canonical address. |
| `repository` | Host, owner, name, default branch, host description, `avatar`, the owner's picture as the host serves it ([ADR-0031](../adr/0031-a-picture-for-a-repository-comes-from-its-manifest-or-the-operator.md)), and `visibility`: `public`, or `private` for a repository that is only ever answered to someone the git host lets see it ([permissions](permissions.md)). |
| `ref`, `pinned`, `commit`, `path` | Requested ref (`null` for default), whether it is a full commit hash, resolved commit, and mounted repository-root directory. |
| `verified` | Whether the operator or, later, the owner vouches for the repository ([tools](tools.md)). |
| `image` | The picture that stands for the address, as the URL a browser loads it from: the operator's ([admin API](../../deploy/README.md#the-admin-api)), else the one the nearest manifest declares ([format](skill-repo.md#the-repository-manifest-skillcdnmd)), a file of the repository at `commit` at the host or a URL as written; `null` when there is none. |
| `index` | State, or a ready overview with manifest metadata, the `license` that governs the mounted directory outside its skills (`kind`, `name`, `source`), skill/document counts, bounded listings and diagnostics. |
| `index.search` | How the mount is searched right now ([words and meaning](tools.md#words-and-meaning)): `meaning`, whether a search uses the vectors of its sections, and `embedding`, where the embedding of its index stands: `null` where nothing has embedded it, `{ "status": "complete" }`, or `{ "status": "in_progress", "embedded": n, "total": n }` in documents. By words alone where the deployment has no embedding model. |

The overview's manifest carries its own canonical `path`, `name`, `description`, `language` and `translations`, or is absent when no applicable manifest exists. An ancestor manifest's path remains its actual repository path even if ordinary file reading cannot reach it from this mount. Names, descriptions and translations belong to their declaring manifest; language inherits from the nearest ancestor that declares it.

Skill listings expose exact `path`, `directory`, `name`, `description`, warnings and translations. Document listings expose canonical path, title and summary. Overview lists are bounded; clients use the browse and find endpoints' continuations to explore further. Counts cover eligible content, not every file in the git tree. Diagnostics explain unreadable manifests, and `truncated` identifies indexing limits.

### `GET /api/v1/browse/<address>?path=&cursor=&limit=`

The `browse_repo` tool's immediate-folder view. `path` is an optional canonical directory (default: mounted directory), or the path of a file for its outline; `limit` is 1 to 200, default 50. `cursor` continues the same listing.

Entries preserve the real folder tree, name their canonical paths, distinguish files and directories, and identify skill folders and manifest metadata when available. Counts help a client choose a subtree without loading every skill. A manifest adds context to its folder; it creates no shortened path or alias. A skill entry carries its `license` and, when this mount only describes the skill, `describedOnly: true` ([licenses](skill-repo.md#licenses)). The response carries diagnostics, commit and `nextCursor`.

Given a file, the response carries `outline` and no entries ([the outline of a file](tools.md#the-outline-of-a-file)): the file's `path`, its `size` in bytes, its `totalLength` in characters (`null` when the text is not at hand), `headings`, each with its `level`, `text`, `offset` and `length`, paged by `limit` and `cursor`, and `truncated` when the file has more headings than an outline keeps. When there are no headings to list for a reason other than the file's own, `unavailable` says why: `not_markdown`, `not_text`, `too_large` or `described_only`, with the `license` for the last and the `sourceUrl` of the file where one exists.

The optional `overview` describes a readable README of the current folder as `{ path, title, description }`, with nullable title and description. An entry can carry an optional `overviewPath`. These introductions work without manifests, stay in their original language and open through the files endpoint. Their full text is not part of browse results or required skill context. Overview-only files do not add independent search results or document counts; [format rules](skill-repo.md#readme-introductions) determine which README is selected and whether it has another discovery role.

### `GET /api/v1/find/<address>?query=&path=&cursor=&limit=`

The `search_repo` tool's ranked search. `query` is nonblank text of at most 500 characters; `path` restricts the search subtree, defaulting to the mount. `limit` is 1 to 25, default 10, and bounds final results after folding. Use the browse endpoint for directory discovery.

A skill result carries its exact `path`, `directory`, name, description and translations, its `license`, and `describedOnly: true` when this mount only describes the skill ([licenses](skill-repo.md#licenses)). Matching supporting files are folded into the owning skill before pagination, with up to five matching file summaries and `moreFiles` for the rest. A skill occupies its best-ranked member's position, even when only a supporting file matched. Independent document results have canonical path, title and summary, and, with a query, `sections`: the sections of the document that matched, best first, each with its `heading` path, the `offset` and `length` that read it through the files endpoint, and an `excerpt` of the passage or `null` ([sections in a search result](tools.md#sections-in-a-search-result)). A document this mount describes without serving carries no `sections`. Results remain in relevance order across folders; linked-only references are not independent search results.

The words of the query are read with the rules of the pack's `language`, as the index was built ([the words that match](tools.md#the-words-that-match)). Where the deployment offers the search by meaning, the sections nearest in meaning are fused with the words' results and the first results reranked ([words and meaning](tools.md#words-and-meaning)), and the response carries `ranking`: `meaning`, whether the sections nearest in meaning took part or the words answered alone this time, and `reranked`, whether the first results were reranked. The field is absent where only words rank. The response carries the query, result items, diagnostics, resolved `commit` and `nextCursor`.

### `GET /api/v1/skills/<address>?path=&cursor=`

The `load_skill` tool. `path` is required and is an exact canonical `SKILL.md` path. `cursor` continues that skill's context; names and directory aliases are not the canonical API.

The ready response names the `commit` the skill was read from, as every result does, and its `skill` contains:

- `path`, `directory`, `name`, `description`, known front-matter fields, warnings and translations.
- `serving`: the `license` the reader resolved for the skill (`kind`, `name`, `source`), whether the skill is served in `full`, and the `sourceUrl` of its manifest at the host. With `full` false the skill is described only ([licenses](skill-repo.md#licenses)): `body` is empty and the rules, files and references are absent.
- `ruleChain`: applicable manifest bodies in repository-root-to-nearest order, with canonical source paths and fragment information.
- `body`: the skill-body content on this page.
- Supporting-file paths, included-file information and canonical `references` for optional reads.
- `oversized`, when present: the files of the skill over the read limit, each with its `path`, `size` and the `sourceUrl` of its bytes at the host; the files endpoint refuses them ([format](skill-repo.md#what-the-skills-extension-serves)).
- `complete` and `nextCursor`, indicating whether the context requires another call.

Context text is bounded to 16 KiB of UTF-8 per page: root-to-nearest rules first, then the skill body, then declared include files. Metadata and response structure add to that size. A page may contain only part of one rule or file and identifies the fragment. Continue until complete before treating the skill as loaded. Missing required content leaves `complete: false` with a diagnostic; `nextCursor` is absent when pagination cannot repair the failure. Ancestor rules above the mount, and shared pages a skill includes from outside it ([format](skill-repo.md#shared-pages)), are delivered through these pages; their paths do not become general file-read permissions. Translations are for the page's visitor, not alternate skill identifiers or search aliases.

### `GET /api/v1/files/<address>?path=&offset=&limit=`

The `read_repo_file` tool. `path` is a canonical file path inside the mount. `offset` and `limit` are character counts (`limit` 1 to 100,000, default 40,000). Reads do not wait for indexing: they return HTTP 503 with `index.indexing` or `index.failed` until the served set, including exclusions, is known. All reading routes enforce ancestor exclusions and failed policy boundaries.

```json
{ "kind": "file", "commit": "<the commit read>", "path": "marketing/docs/guide.md", "content": "...", "offset": 0, "nextOffset": null, "totalLength": 1234 }
```

A file page names the `commit` it was read from and never splits a character. Use the browse endpoint for directories. Raw files do not add inherited rules or stand in for loading a skill. A file over the read limit answers `413` with `file.too_large`, and one that is not UTF-8 text `415` with `file.not_text`; both errors carry the `sourceUrl` of the file's bytes at the host, the only place to get what this endpoint cannot carry.

MCP additionally bounds its complete serialized tool result and can return shorter pages than these REST limits. The byte budget and continuation behavior are defined in [tools](tools.md#results-and-continuations).

### `GET /api/v1/featured`

The addresses the operator selects for the explorer (the featured list of the [admin API](../../deploy/README.md#the-admin-api)), with their repository metadata (the owner's `avatar` included), manifest introduction when available, whether the repository is `verified`, the `image` that stands for the address as on the mount (or `null`), index status, skill count and a few skill names. While the operator features nothing, the reference repository is featured ([ADR-0028](../adr/0028-the-front-page-and-the-explorer-are-operator-content.md)). Unresolvable addresses are omitted, and so is a repository whose index found no license ([ADR-0026](../adr/0026-serving-follows-the-license-and-the-operators-lists.md)). There is no public enumeration of every indexed repository: asking for an address alone does not opt its author into a catalog.

### `GET /api/v1/owners/gh/<owner>?page=`

The page of an account of the git host ([ADR-0037](../adr/0037-an-account-has-a-page-made-from-what-the-git-host-shows-everyone.md)), for any account, whether or not it ever signed in here, and the same for everyone who asks. Exists where the deployment has a git host to list from.

| Field | Meaning |
|---|---|
| `owner` | `host`, `login` as the host spells it, `name` and `bio` (or `null`), `kind` (`organization` or `user`), `avatar`, the `url` of the account's page at the host, and `publicRepositories`, the host's count. |
| `indexed` | On the first page only: the account's public repositories whose default branch this deployment has indexed and found skills in, most skills first, as the cards of `GET /api/v1/featured`. Read from the index; a repository is listed only while the host still shows it to everyone. |
| `repositories` | A page of the account's other public repositories as the host lists them, most recently pushed first: `address`, `name`, `description`, `fork`, `archived`, `stars` and `pushedAt` (an instant, or `null`). What `indexed` shows is left out, on every page. |
| `nextPage` | The `page` to ask for next (1 to 100), or `null`. |

Asking indexes nothing: a repository is indexed when somebody opens its address. Private and blocked repositories never appear, whoever asks. `404` with `owner.not_found` for a name the host shows no account for; `503` when the host cannot be asked.

### `GET /api/v1/showcase`

The entries the front page leads with (the showcase of the [admin API](../../deploy/README.md#the-admin-api), [ADR-0028](../adr/0028-the-front-page-and-the-explorer-are-operator-content.md)), in order. An entry carries its `id`, the `address` it leads to, its `position`, the `width` and `height` of its media, the `durationMs` and `published` date of its clip (`null` without one), `media` with a `url` and a `type` in each slot (`poster` always; `clip`, `animation`, `reference`, `picture` and `social`, or `null`), and `texts` by language tag: `title`, `body`, `tags`, `action`, and `requirement`, `clip`, `credit` and the example conversation `demo`, or `null`. Empty until the operator writes an entry; the pages then show the build's own showcase.

Media URLs are paths under `/media/`, named by the SHA-256 of the file: they never change, are served with `cache-control: public, max-age=31536000, immutable` and answer byte ranges. Anything else under `/media/` is `404`.

### `GET /api/v1/legal/<kind>`

A page of the deployment's own ([ADR-0029](../adr/0029-terms-and-privacy-pages-can-be-written-into-the-deployment.md)): `terms` or `privacy`, as the operator wrote it through the [admin API](../../deploy/README.md#the-admin-api). The document carries its `kind`, the `revised` date (`YYYY-MM-DD`, or `null`) and `texts` by language tag, each a `title` and a `body` in Markdown. `404` with `legal.not_found` for a page that has not been written, and for any other kind. The pages themselves are served at `/terms` and `/privacy`, rendered with the document.

## Serving an agent from a program

A program that gives an agent what MCP gives it, a console, a command-line tool, a job, reads the same index through these routes, with a token where the repository is not public ([authorization](#authorization)). The API carries data and no prose for a model: there are no connection instructions and no prompt here, and what an MCP client passes to its model ([tools](tools.md)) is for the program to say in its own words. It need not find them: `packages/core` builds every body of these routes from the reader's results (`mountBody`, `browseBody`, `findBody`, `skillOutcome`, `fileBody`) and reads each back as the result it was made from (`mountSummaryOf`, `catalogStateOf`, `browseResultOf`, `findResultOf`, `skillResultOf`, `fileResultOf`, `directoryResultOf`), and `joinSkillPages` makes one skill of its pages, so that a program renders the text an MCP client's model is given, with the same functions the MCP endpoint renders it with (`renderInstructions`, `renderBrowseResult`, `renderFindResult`, `renderSkillResult`, `renderFileResult`). `@skillcdn/client` is this API as typed functions, with a token sent to one origin and no redirect followed ([ADR-0056](../adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)); the `skillcdn` command is such a program. A deployment counts a read through these routes as it counts a tool call, under the route as the subject (`rest/mounts`, `rest/browse`, `rest/find`, `rest/skills`, `rest/files`), the first page of a skill as a load of the skill and the first page of a file as a read of it, and the client by the product token its `User-Agent` begins with (`skillcdn-cli`, `curl`; `browser` for any browser), as [usage statistics](../architecture.md) says.

| Over MCP | Over REST | What to give the agent |
|---|---|---|
| Connecting: the server's instructions and info | `GET /api/v1/mounts/<address>` | The pack's name and description (the manifest's, else the README summary, else the host's description), the mounted path and the commit, the counts, the folder overview and the diagnostics. The instructions MCP renders on connect are made from this overview, within 2,000 characters ([connection and prompt](tools.md#connection-and-prompt)). |
| `browse_repo` | `GET /api/v1/browse/<address>?path=&cursor=&limit=` | The entries with their canonical paths, skill folders marked, counts, and the folder's `overview` to read on demand; for a file, its `outline`, each heading with the offset and length that read its section. |
| `search_repo` | `GET /api/v1/find/<address>?query=&path=&cursor=&limit=` | The results in relevance order, a skill with its matching files folded under it, a document with the `sections` that matched and what reads each, and `describedOnly` where a license keeps the content at its source. Words in the pack's language, and meaning where the deployment offers it, with `ranking` saying which took part. |
| `load_skill` | `GET /api/v1/skills/<address>?path=&cursor=` | The `ruleChain` from the repository root to the nearest manifest, then the `body`, then the included files, in that order and each labeled by its source, as [loading a skill](tools.md#loading-a-skill) lays them out. Follow `nextCursor` until `complete` before giving the agent the skill, never a page alone. A skill with `serving.full` false is described only: its name, description, license and `sourceUrl`, and nothing else. |
| `read_repo_file` | `GET /api/v1/files/<address>?path=&offset=&limit=` | The text, continued at `nextOffset`; a directory listing for a folder; the `sourceUrl` of what cannot be carried. The source `SKILL.md` as written, never a skill load. |
| The `use_skill` prompt | none | A convenience of MCP clients. A program starts loading a skill by its path. |
| The skills extension: the listed skills, their digests, the assembled `SKILL.md` | none yet | Routes for the listed skills, their digests and the assembled document are planned ([roadmap](../roadmap.md)); until then a program that installs skills into an agent's own folder speaks MCP for it. |

What the program tells the agent is what the tool descriptions tell a model ([inputs](tools.md#inputs), [indexing and trust](tools.md#indexing-and-trust)): content paths start at the repository root and are the only identifiers, a cursor continues one listing and is not reusable, every result names its commit and a moving ref may move between calls, and the content comes from the pack's author, under its license and with its provenance notice until the repository is vouched for. A program that holds a token sends it with every request, keeps it where passwords are kept and prints it nowhere; what it reads from a private repository is that person's for the staleness bound, so it shows it to that person's agent and keeps no copy beyond the request.

## People

Present only on a deployment where people sign in ([permissions](permissions.md#signing-in)); elsewhere these paths are `404`. Signing in and out are navigations under `/auth/`, described there. Everything here is `no-store`.

### `GET /api/v1/me`

`{ "user": ... }`: who the session cookie says is signed in (`host`, `login`, `name` or `null`, `avatar`), or `null` for nobody. Nobody is an answer, not an error; the pages ask this once to decide what the header shows.

### `GET /api/v1/me/repositories`

The repositories the person can reach through the git host's app, by where it is installed: `installUrl` (where the app is added to an account or to repositories at the host, or `null`), and `installations`, each with its `account` (`login`, `kind`, `avatar`), `manageUrl` (or `null`), `selection` (`all` or `selected`), its `repositories` (`address`, `owner`, `name`, `description`, `visibility`) and whether the list is `truncated`. The answer is the host's, asked with the person's own token, and bounded: a long list is cut and says so, and the rest opens by address. `401` with `auth.required` for nobody, and also when the host no longer accepts the person's sign-in, which signs them out.

### `GET /api/v1/me/grants` and `DELETE /api/v1/me/grants/<id>`

The apps the person allowed to read an address as them: `items`, newest first, each with its `id`, the `client` (`name`, and `uri` or `null`, both the client's own word), the `address`, `createdAt` and `lastUsedAt` (or `null`). Deleting one ends it at once, with every token under it; it must come from the deployment's own pages.

### `GET /api/v1/me/tokens`, `POST /api/v1/me/tokens` and `DELETE /api/v1/me/tokens/<id>`

The tokens the person made for agents that have nobody to sign in ([permissions](permissions.md#tokens-for-agents-with-nobody-to-sign-in)). Listing answers `items`, newest first and without those that expired, each with its `id`, the `address` of the repository it reads, the `label` its maker gave it, `createdAt`, `expiresAt` (`null` for a token made without an end, [ADR-0060](../adr/0060-a-repository-token-may-have-no-end.md)) and `lastUsedAt` (or `null`), and `limit`, how many a person may hold. A secret is on no list.

Making one takes `{ "address": "/gh/<owner>/<repo>", "label": "...", "expiresInDays": 1..366 or null }` from the deployment's own pages and answers `201` with `{ "token": "scdn_repo_...", "item": ... }`: the secret, this once. `400` with `token.invalid` for a body that is not that (the label is one to sixty characters), with `token.not_a_repository` for an address with a ref or a path, and with `token.public_repository` for a repository everyone reads; `404` with `mount.repo_not_found` for a repository the person cannot open, the same as for a name that is nothing; `409` with `token.limit` when they hold as many as one may; `503` when the git host could not be asked. Deleting one ends it at once, and answers `404` with `token.not_found` for a token that is not theirs.

### `GET /api/v1/me/index/<address>` and `POST /api/v1/me/index/<address>`

What the person signed in may ask of a repository's index, and the asking ([ADR-0064](../adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)). Reading answers `{ "administers": true | false }`: whether the git host, asked as the person, says they administer the repository. Asking, from the deployment's own pages, queues the repository to be indexed now and its documents embedded ahead of everything else, for a repository that is not public as well, and answers `202` with `{ "queued": true }`, or `false` when the same address waits in the queue already; the address names a repository, with a ref at most. `401` with `auth.required` for nobody; `400` with `index.not_a_repository` for an address with a path; `404` with `mount.repo_not_found` for a repository the person cannot open, the same as for a name that is nothing; `403` with `index.not_administrator` for someone who reads the repository without administering it; `503` with `index.unavailable` where the deployment runs no worker, and with `mount.unavailable` when the git host could not be asked.

### `GET /api/v1/oauth/request?request=` and `POST /api/v1/oauth/decision`

What the consent page asks and answers ([permissions](permissions.md#the-flow)). The first describes a sealed authorization request: the `client` (`name`, `uri`, the `redirectHost` its answer goes to, which is the host of a web address or the scheme of an app's own link, and whether that is `loopback`, an app on the person's own computer), the `address`, the `scope`, the `user` who would be agreeing (or `null`), whether that person can see the repository right now (`visible`: `true`, `false`, or `null` when nobody is signed in or the host could not be asked; a repository that does not exist is the same `false`), and `installUrl`. The second takes `{ "request": "...", "approve": true | false }` from the signed-in person, from the deployment's own pages, and answers `{ "redirect": "..." }`: where the browser goes with the answer. `400` with `oauth.invalid_request` for a request that has expired. An approval is taken only for an address its person can open: `403` with `oauth.not_visible` otherwise, the same for a repository that is not theirs and for a name that is nothing, and `503` with `mount.unavailable` when the git host could not be asked. A refusal is always taken.

### `POST /api/v1/connect`, `GET /api/v1/connect/<code>`, `POST /api/v1/connect/<code>/decision` and `POST /api/v1/connect/claim`

How a command gets a repository token without anyone seeing it ([permissions](permissions.md#a-command-connects-with-a-code), [ADR-0059](../adr/0059-the-command-connects-with-a-code-a-person-approves.md)). The command begins with `{ "address": "/gh/<owner>/<repo>", "agent": "..." }`, as nobody, and is answered `201` with the `code` to show a person, the `url` of the code's page, the `secret` it claims with, `expiresAt` and `intervalSeconds`. The person, signed in, reads the request under its code (`agent`, `address`, `expiresAt`, `approved`, `user`, `visible`, `installUrl`) and answers it from the deployment's own pages with `{ "approve": true, "label": "...", "expiresInDays": n or null }` or `{ "approve": false }`, answered `{ "status": "approved" | "denied" }`. The command claims with `{ "secret": "..." }` and is answered `{ "status": "pending", "expiresAt": "..." }` until the person approved, then once `{ "status": "connected", "token": "scdn_repo_...", "item": ... }`, the item being what the person's token list shows. The refusals are the token form's (`token.not_a_repository`, `token.public_repository`, `mount.repo_not_found`, `token.limit`) and the connection's own (`connect.invalid`, `connect.not_found`, `connect.busy`). Everything here is `no-store`.

### `GET /social/<address>?lang=&skill=`

The social preview of the page of an address ([ADR-0032](../adr/0032-social-previews-are-drawn-by-the-server-for-each-address.md)): a 1200 by 630 PNG the server draws with the owner's picture, the name, the address, the description and a few facts, in the language `lang` names (else the one the request asks for, with `vary: accept-language`), and for the skill at the canonical `SKILL.md` path `skill` names when given. The page of an address names it as its `og:image`. Asking for it resolves the address and starts indexing it, as asking for the page does; a card drawn before the index is ready says less and is drawn again once it is. `404` for an address that is nothing, a repository that is not public (a card is drawn for whoever a link is sent to), a skill that is not there, or a deployment without the web UI. Answered with `cache-control: public, max-age=3600`, an ETag, and byte ranges.

### `GET /social/docs[/<page>]?lang=`

The social preview of a page of the documentation, or of its index without a page ([ADR-0049](../adr/0049-the-documentation-is-rendered-into-the-pages-from-the-repositorys-own-files.md)): the same card, drawn from the words the build writes for the page, with the site's symbol where an owner's picture would be, in the language `lang` names (else the one the request asks for, with `vary: accept-language`). `404` for a page that is not one, or a deployment without the web UI. Answered with `cache-control: public, max-age=3600`, an ETag, and byte ranges. The pages themselves, `/docs` and `/docs/<page>`, and the Markdown beside each, `/docs/<page>.md`, are files of the web build, not routes of the API.

### `GET /badge/<address>`

The badge of an address, for the README of its repository: an SVG 20 pixels tall with the symbol, the name of the service and how many skills the address serves (`12 skills`), or `indexing` until the index is ready and `unavailable` when it failed. Asking for it resolves the address and starts indexing it, as asking for the page does. `404` for an address that is nothing or a repository that is not public (a badge is shown to whoever reads the README). Answered with `cache-control: public, max-age=3600` (`max-age=60` until the index is ready), an ETag, and byte ranges. In a README, linked to the page of the address:

```md
[![SkillCDN](https://skillcdn.ai/badge/gh/<owner>/<repo>)](https://skillcdn.ai/gh/<owner>/<repo>)
```

The badge carries the symbol; the [trademark policy](../../TRADEMARKS.md) allows it, as served, for a repository the deployment serves.

### `GET /icon/<address>`

The icon of the MCP server of an address ([tools](tools.md#connection-and-prompt)): the owner's picture as the git host serves it, 128 pixels square, fetched without credentials and served on from this origin, because a client fetches a server's icon from the server's own origin and from nowhere else. Served only when the bytes are a PNG, JPEG, GIF or WebP by their own first bytes, whatever the host said; `404` otherwise, and for an address that is nothing or not public. Answered with the image's type, `cache-control: public, max-age=86400` (an account's picture rarely changes), an ETag that names the account and the size, and byte ranges.

