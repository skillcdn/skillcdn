# Architecture

> **Status: current design.** This document describes the system as it is built and marks what is not built yet; [roadmap.md](roadmap.md) says what comes next. It is kept current: when the implementation diverges from it, update it in the same change. Decisions with lasting consequences are recorded in [adr/](adr/).

## Overview

```
agent (any MCP client)
   |   https://<host>/gh/<owner>/<repo>[@ref][/path]
   |   anonymous for public repos; OAuth for private repos, or a repository token where nobody can sign in
   v
server, role api        stateless: MCP over HTTP, REST for the web UI and for programs that serve an agent, sign-in and OAuth, the git host's events; indexes a commit when it is first asked for
   |
   v
PostgreSQL              content index (full-text), permission cache, file bodies keyed by content hash, people and their tokens
   ^
git host                GitHub, behind the git-host port
```

The `worker` role runs the jobs of the search by meaning; a worker that indexes ahead of requests, a blob store on S3-compatible storage behind the same port, other git hosts behind the git-host port and the search by meaning itself are planned ([roadmap.md](roadmap.md), [ADR-0004](adr/0004-postgresql-only-state.md), [ADR-0063](adr/0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md), [ADR-0064](adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)).

Four properties shape everything else:

- **Git is the source of truth.** We read, index and serve. We never host content, and a pinned ref serves exactly what was reviewed.
- **The git host owns permissions.** We ask it whether a user can see a repo and cache only the yes/no answer ([specs/permissions.md](specs/permissions.md)). There is no user or team model of our own: a token a person makes for an agent reads as that person, and no further.
- **One image, one database.** Hosted and self-hosted run the same build against PostgreSQL. Nothing in the core path needs a particular cloud.
- **Repositories declare, they never execute.** Skills are Markdown plus declarations. We run no third-party code, on the server or on the user's machine.

## Workspaces and boundaries

| Workspace | Responsibility | May import |
|---|---|---|
| `packages/core` | Address scheme, skill-repo convention, permission rules, tool contracts and the renderers of their text, the REST bodies, the search word rules, and the ports everything else implements, the `IndexStore` among them ([ADR-0054](adr/0054-the-reads-are-a-package-over-an-index-store-port.md)). Pure: no I/O, no Node APIs, usable in a browser. | nothing |
| `packages/db` | PostgreSQL schema, migrations, query layer. | `core` |
| `packages/github` | GitHub implementation of the git-host ports: contents, the app's installation tokens, signing in and what a person can see, the public listing of an account, and the deliveries of the app's webhook. | `core` |
| `packages/indexer` | The reading rules ([ADR-0045](adr/0045-the-indexer-is-a-package-and-check-is-a-command.md)): a commit read into an index through the git-host port, a working tree read the same way for `check`, `INDEX_VERSION`, and the limits with the variables they are read from. Node.js only: no database, no environment. | `core` |
| `packages/reader` | The reads ([ADR-0054](adr/0054-the-reads-are-a-package-over-an-index-store-port.md)): a folder browsed, a search, a skill assembled and paged, a file read, and what the skills extension lists, over the `IndexStore` port of `core`, wherever the index is kept. Node.js only: the index and a missing body come from the caller. | `core` |
| `packages/client` | The REST API as typed functions ([ADR-0056](adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)): one per route, every answer parsed with core's schemas, every failure an `ApiError` with the API's code, a token sent to one origin and no redirect followed. Node.js and the browser alike. | `core` |
| `packages/serve` | The edges as a library ([ADR-0057](adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)): the MCP tools, the prompt and the skills extension of a mount, and the five REST routes that read an address, over a reader, with what a deployment counts as hooks; a local app and a stdio server for a machine's own mounts. Hono and the MCP SDK live here and in the server. | `core`, `reader` |
| `packages/cli` | The `skillcdn` command: `check` for an author before pushing, and `skills`, `browse`, `find`, `skill` and `file` for an agent, which print what an MCP client's model is given from a pack, from a directory read into an index in memory or from a deployment through the client ([ADR-0055](adr/0055-the-command-reads-a-pack-as-a-deployment-serves-it.md), [ADR-0056](adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)); `login`, `logout` and `logins` keep a token per deployment and repository ([ADR-0059](adr/0059-the-command-connects-with-a-code-a-person-approves.md)), `use` binds a directory to a pack and `status` says what it reads; `mcp` and `serve` serve a directory over stdio and HTTP ([ADR-0057](adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)). Arguments, environment, output and exit codes; the rules are the indexer's, the reads the reader's, the words core's, the edges serve's. | `core`, `indexer`, `reader`, `client`, `serve` |
| `packages/brand` | The pictures of the brand as files ([ADR-0048](adr/0048-the-brand-files-are-a-package-of-their-own-under-the-trademark-policy.md)): the symbol, the wordmark, the lockup and the icons made from them, each an export by its path, under the trademark policy rather than the code's license. No code; its script draws the raster files from the path data in `core`. | nothing |
| `apps/server` | Composition root: configuration, sign-in and authorization, the pages, adapter wiring, and the MCP and REST edges of `serve` composed with the deployment's mounts and statistics. | `core`, `db`, `github`, `indexer`, `reader`, `serve` |
| `apps/web` | Optional web UI: landing page, explorer and the documentation, in several languages. Talks to `api` over REST only; builds to static files, prerendered per language ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md)), the documentation among them, rendered at build time from the repository's own Markdown ([ADR-0049](adr/0049-the-documentation-is-rendered-into-the-pages-from-the-repositorys-own-files.md)), plus a render module the server calls for the page of an address ([ADR-0011](adr/0011-address-pages-rendered-on-the-server.md)) and for the front page with the operator's showcase ([ADR-0028](adr/0028-the-front-page-and-the-explorer-are-operator-content.md)). | `core` (types, schemas, address parsing), `brand` (the files it serves), `client` (the REST API) |

Where new things go:

- A new git host is a new package that implements the git-host port from `core`.
- What has one consumer starts as a module inside `apps/server` and moves into a package when a second consumer appears, not before: the indexing pipeline moved to `packages/indexer` when the `check` command became one ([ADR-0045](adr/0045-the-indexer-is-a-package-and-check-is-a-command.md)), the reads to `packages/reader` when the command was to answer them from a directory ([ADR-0054](adr/0054-the-reads-are-a-package-over-an-index-store-port.md)), and the MCP and REST edges to `packages/serve` when the command was to serve one ([ADR-0057](adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)).
- Anything that needs the network, the clock, randomness or the environment is a port in `core` with an adapter elsewhere.

## Related repositories

Two reference repositories sit beside this one: examples that follow the standard and are meant for real use. Nothing here imports from either, and neither defines anything of the specification:

- [`skillcdn/skills`](https://github.com/skillcdn/skills), the reference pack, in the format [specs/skill-repo.md](specs/skill-repo.md) specifies: what the explorer offers to try, and the one a fresh deployment shows.
- [`skillcdn/console`](https://github.com/skillcdn/console), the reference console: where an organization runs its work with AI agents, a board of the work, the agents at it, and the decisions that wait for a person. It has its own repository, versions and releases, and is packaged on npm so that anyone can build their own console from it ([ADR-0047](adr/0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)). It consumes `@skillcdn/core` from npm and the REST API of a deployment, like any other consumer; `apps/web` stays the UI of a deployment.

## Runtime: one image, several roles

`apps/server` builds into a single container image. The container command selects the role:

| Role | What it does | Scaling |
|---|---|---|
| `api` | Serves HTTP. Holds no state another replica needs. | Any number of replicas. |
| `worker` | Runs the jobs of the queue ([ADR-0064](adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)): indexes a repository on request, embeds the sections of indexed commits where an embedder is configured and the database keeps vectors, and sweeps hourly for what is served and not yet embedded under the configured model, dropping a replaced model's vectors once nothing is left. Indexing ahead of requests, when a push arrives and on a schedule, is still to come ([roadmap](roadmap.md)); until then `api` indexes lazily. | One is enough; several share the queue. A stopped worker hands its running jobs back. |
| `migrate` | Applies pending migrations, then exits. | Run once, before a new version rolls out. |
| `check` | Reads a directory as the indexer reads a commit and prints what an agent would get; for repository authors, before they push ([ADR-0020](adr/0020-a-check-role-reads-a-working-tree-with-the-indexer.md)). Needs no database and no git host. The same code is the `skillcdn check` command of `packages/cli`, for authors without the image. | Runs on an author's machine or in a repository's CI, then exits. |
| `purge` | Removes what was indexed for one repository, then exits ([ADR-0026](adr/0026-serving-follows-the-license-and-the-operators-lists.md)). The same purge is a route of the admin API. | Runs from an operator's shell when content must go. |

Process contract: `GET /healthz` reports liveness, `GET /readyz` reports readiness (database reachable, schema at the expected version). On `SIGTERM` the process stops accepting work, drains what is in flight, hands unfinished indexing back to the database and exits within the grace period.

## Request paths

**Public repo.** Parse the address (`core`), resolve the repository and ref to a commit, and answer from the shared index for that `(repo, commit)`. An unknown repository or ref is a `404` at connect time. The first request starts indexing; `browse_repo`, `search_repo`, `load_skill` and the skills extension's methods wait within a budget, while `read_repo_file` returns the indexing state until the publication policy is known ([tools](specs/tools.md), [ADR-0023](adr/0023-optional-introductions-and-explicit-publication.md)). All content paths stay relative to the repository root. A sub-path mount clips the served set; it does not redefine identity or recompute reference reachability.

**A browser.** When the deployment serves the web UI, a `GET` that accepts HTML is answered with a page: a prerendered one for the static routes, in the language the `lang` parameter names, else the one the request's `Accept-Language` asks for ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md), [ADR-0021](adr/0021-a-url-without-a-language-is-served-in-the-language-asked-for.md)), and for an address a page rendered on the spot by the build's render module with what the address serves, the same answers the REST API gives ([ADR-0011](adr/0011-address-pages-rendered-on-the-server.md), [specs/rest.md](specs/rest.md)). Serving the page of an address resolves it and starts indexing, like the API. The server reads the build's manifest and knows nothing else about the UI.

**Private repo.** An owner installs the GitHub App on selected repos (contents and metadata, read-only). A person signs in through the app, in the browser or from their MCP client, and either way from the deployment's own pages, which say what they continue with and agree to ([ADR-0041](adr/0041-a-sign-in-begins-on-a-page-of-the-deployments-own.md), [ADR-0043](adr/0043-a-sign-in-begins-in-a-dialog-over-the-page.md)): the deployment is its own OAuth authorization server, hands off to the git host's login, keeps the resulting user token server-side and encrypted, and issues its own token to the agent, good at one address ([ADR-0035](adr/0035-people-sign-in-through-the-git-hosts-app.md), [ADR-0036](adr/0036-the-deployment-is-the-authorization-server-of-its-addresses.md)). A request from nobody in particular is resolved as everyone sees the name. A person's request for a repository known to be public is answered as anyone's is. For anything else it looks first at what the host last let that person read, then asks the git host as everyone, and then, as the person, whether they can see the repository; a yes is cached for a short time. Nothing one caller's request leaves behind answers another's, so a private repository in use and a name that is nothing cost a stranger the same. Content is read and indexed with the installation token, never the person's. An MCP request without a token for anything that is not public gets a challenge that says where to ask for access, the same for a private repository and for a name that is nothing. A public address never asks and publishes nothing about signing in, so a client finds no authorization there however it looks for it. [specs/permissions.md](specs/permissions.md) is the contract. Where the deployment receives the git host's events, a push, a change of visibility, a removed installation and a change of who can see a repository end what is remembered at once; an event ends and never establishes, so the host is asked again ([ADR-0038](adr/0038-the-git-hosts-events-end-what-is-remembered.md)). An agent that has nobody to sign in is given a **repository token** by a person who can open the repository: good for that one repository, read-only, revocable, with an end or without one ([ADR-0060](adr/0060-a-repository-token-may-have-no-end.md)), and reading as its maker, so the git host still decides what it opens ([ADR-0040](adr/0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md)).

**The page of an account.** One segment short of an address, `/gh/<owner>`, answers a browser with the account's public repositories as the git host lists them, the ones already indexed with skills first. Listing indexes nothing and shows only what the host still shows everyone. The page is rendered on the server and open to search engines, like the page of an address ([ADR-0037](adr/0037-an-account-has-a-page-made-from-what-the-git-host-shows-everyone.md)).

Details and open questions live in [specs/](specs/).

## Data and storage

PostgreSQL is the only stateful dependency and plays every stateful role: content index with full-text search, permission cache, the store of file bodies, the vectors of the search by meaning where its `vector` extension is available, with how far each snapshot has been embedded, and the job queue, in a schema of its own ([ADR-0004](adr/0004-postgresql-only-state.md), [ADR-0063](adr/0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md), [ADR-0064](adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)). Conceptual entities (the actual schema is documented in [`packages/db/README.md`](../packages/db/README.md)):

- **Account**: an organization or user on a git host. Everything tenant-scoped hangs off an account.
- **Repo**, **ref → commit** resolution, and **index entries** per `(repo, commit)`: canonical path, kind, front-matter, discoverability, readability, reference targets, search vector, blob hash, the digest and size of what the file is served as, and whether the skills extension lists a skill. Index entries for a commit are immutable. The reading-rule version invalidates indexes when interpretation changes.
- **User** (an account that signed in), its **git-host user token** (encrypted at rest), **sessions**, **OAuth clients, codes, grants and tokens** (every secret stored as a hash), and the **permission cache** `(user, repo) → boolean` with the time it was answered, the **repository tokens** people made for agents (stored as hashes), and the **connection requests** of commands waiting for a person's approval (the secret as a hash, never a token; [ADR-0059](adr/0059-the-command-connects-with-a-code-a-person-approves.md)).
- **Snapshots** per `(repo, commit)`: how far the index of a commit has come, and the claim that decides which process builds it ([ADR-0007](adr/0007-snapshot-rows-coordinate-indexing.md)).
- **Section vectors** per blob hash, model and version of the sectioning rules: the vector of the meaning of each section of a file body, with the section's heading path, offset and length, shared by every commit, ref and fork that holds the same bytes and reached only through an index entry; the table exists only where the database has the `vector` extension ([ADR-0064](adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)).
- **Snapshot embeddings** per snapshot and key: how far the worker has embedded a snapshot's sections and when it finished, which is what tells a served snapshot still to embed from one that is done; a rebuilt index drops them. **Jobs** of the queue, in the `pgboss` schema the `migrate` role installs: the slices of embedding, the indexing on request and the hourly sweep ([ADR-0064](adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)).

Indexing first identifies declaration boundaries, then reads manifests and skills, discovers declared documents, and expands local Markdown references within bounded work; it builds the search vector of every searchable entry with the word rules of the pack's language, and every store keeps that vector as it is, so that a pack is found by the same words in a deployment and in the command ([ADR-0063](adr/0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md)). A failed manifest retains its boundary even when its body exceeds limits. Valid skills may declare hidden roots; individual links never expose siblings. Linked-only files are readable without becoming independent search results. Applicable rules are computed by ancestry and delivered completely through `load_skill` pages, including ancestor rules above a sub-path mount. These pages do not grant general reads outside the mount ([ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md)). A third round fetches every file of the skills the skills extension may list, so that each has a SHA-256 digest, and computes the digest of the document each listed skill is served as ([ADR-0025](adr/0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)).

**Usage statistics** are daily counters of what agents do, over MCP and over the REST API alike: a read through the API is a call of its route (`rest/<route>`), and its client's app is the product token the user agent begins with, `browser` for a browser. Per public repository: connections, tool calls per tool, loads per skill, reads per file and distinct clients. For the deployment as a whole: the same counts over every repository, public or not, which name no repository and no path, and distinct clients by the app they used. A connection is a completed handshake, which only the earlier protocol revisions have: a client of the current revision adds to the other counts and nothing to this one, so the count falls as clients move to that revision, whatever their number. A skill's document is a load of the skill whichever way it was read, by the tool, by the skills extension or as a file; any other file read is counted by its repository-root path, once per file rather than per page. Each `api` process adds up what it sees and writes the totals every few seconds with an additive upsert, so replicas need no coordination and a request never waits for a write. Distinct clients are told apart by a keyed hash of the client's address under the key of its UTC day, derived from a configured secret and never stored ([ADR-0010](adr/0010-distinct-clients-by-daily-keyed-hash.md), [ADR-0027](adr/0027-client-hashes-are-keyed-from-a-configured-secret-and-the-day.md)); when the day is over the hashes become a count and are deleted, and the database alone can match nothing to an address. The app a client used is the name it gives itself in the protocol, in its handshake or in each request, or in its user agent over the REST API, kept as one short lower-case line, with a bound on how many different names a day takes before the rest count as `other`; it travels with the deployment's row of the client and becomes a count per app with the day. The statistics store no address, user agent or other identifier, and a repository that is not public is never named in them. The access log, which does record the client address and user agent of each request, is a separate log with its own switch ([deploy](../deploy/README.md)). The operator reads the statistics through the admin API ([deploy](../deploy/README.md)); what to rank or recommend from them is for whoever consumes them. They are not the `UsageSink` port, which carries metering events for whoever operates a deployment.

Identifiers are UUIDv7; timestamps are `timestamptz`. File bodies are stored as bytes under their git blob hash, which deduplicates across commits, refs and forks, and means a new commit only fetches what changed; text is derived from the bytes, so that what is served is what was digested. The blob-store port has a PostgreSQL implementation, which keeps the smallest install at one dependency; an implementation over S3-compatible storage, for bodies that do not belong in rows, is planned behind the same port ([ADR-0004](adr/0004-postgresql-only-state.md)).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript 7, ESM only. pnpm pins both itself and the Node.js runtime in the lockfile. |
| Monorepo | pnpm workspaces with a catalog, Turborepo, TypeScript project references. Packages compile to `dist/`. |
| HTTP | Hono on the Node.js adapter. |
| MCP | The official MCP TypeScript SDK, v2, over Streamable HTTP. One server instance per request, no sessions or selected-role state ([ADR-0006](adr/0006-mcp-sdk-v2-per-request-servers.md)). Four tools (`browse_repo`, `search_repo`, `load_skill`, `read_repo_file`) return text written for the model and nothing else ([ADR-0034](adr/0034-a-tool-result-is-the-text-written-for-the-model.md)); one `use_skill(path)` prompt loads any exact skill. Connection instructions introduce folders ([ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md)). Skills also travel through the MCP skills extension `io.modelcontextprotocol/skills`, assembled from their sources and digested as served ([ADR-0024](adr/0024-skills-travel-through-the-mcp-skills-extension.md), [ADR-0025](adr/0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)). |
| Validation | Zod at every boundary. |
| Database | PostgreSQL 18: `tsvector` + GIN full-text search, JSONB, native `uuidv7()`; the `vector` extension (pgvector) for the search by meaning where the server has it, else that table is left out and the search stays by words. |
| Data access | Drizzle ORM on the `pg` driver; migrations are generated, reviewed SQL files. The ORM never leaves `packages/db`. |
| Jobs | pg-boss. Retries, deduplication keys and schedules without a separate broker. |
| Blob storage | S3 API: Amazon S3 when hosted, MinIO or local disk when self-hosted. |
| Logging | pino, JSON to stdout. |
| Quality | Biome (lint and format), Vitest, gitleaks. |
| Web | Vite + React, plain CSS with design tokens, no component library. Pages that should be found are prerendered once per language at build time. |
| Delivery | One multi-stage Dockerfile (Debian slim, non-root, arm64 first). CI builds the image and exercises it on every change. Publishing and rollout happen outside this repository ([ADR-0008](adr/0008-repository-ends-at-an-image-that-builds.md)). |

Libraries are added to `package.json` when first used; this table records the decision, not what is installed.

## Configuration and secrets

- Configuration comes from environment variables only, parsed and validated once at boot in `apps/server/src/config/`. Invalid configuration stops the process with a clear message.
- Every secret `NAME` may also be supplied as `NAME_FILE`, so container secret mounts work.
- Nothing secret is baked into an image, passed as a build argument or committed. Hosted deployments inject values from the platform's secret store at runtime.
- [`.env.example`](../.env.example) is the contract and is updated with the code.

## Caching and cost posture

Infrastructure-level caching, DNS, TLS and edge configuration are outside this repository. The application's part:

- **Immutable by construction.** Anything addressed by a commit hash never changes: index once per `(repo, commit)` and share it across all users. Every read over MCP and REST is sent `Cache-Control: no-store` today ([specs/rest.md](specs/rest.md)); caching pinned public reads as immutable, and revalidating moving refs with the commit hash as the `ETag`, is planned.
- **Moving refs** (branches, tags, the default branch) are looked up again after a short time (`REF_TTL_SECONDS`), or at once where the git host's events arrive ([ADR-0038](adr/0038-the-git-hosts-events-end-what-is-remembered.md)).
- **Private responses** are always `Cache-Control: private, no-store`, and MCP results of a repository that is not public say `cacheScope: "private"`.
- **Be cheap toward the git host.** Conditional requests; one tree listing per commit; bodies fetched by content hash, so a new commit only costs what changed; one archive download instead of many per-file calls when a repository is new; webhooks instead of polling; backoff on rate limits. The host's request quota is the scarce resource, not bandwidth.
- **Bound the work per repo.** Text formats only, with caps on file count and size. Caps are configuration with safe defaults.
- **Stay small.** Stateless `api` runs on small arm64 instances and scales horizontally; one PostgreSQL covers search, cache and bodies.
- The server honors forwarding headers only from a configured trusted proxy.

## Security model

- **Untrusted input:** repository content, every request, and webhook deliveries until their signature is verified, over the raw body and in constant time. A verified delivery still only ends what is remembered and never states a fact, so one that is replayed or arrives late costs a question to the git host and nothing else.
- **No execution.** Repository content is parsed as data with size and depth limits, safe YAML, normalized paths, no traversal and no symlink following. Local Markdown references are resolved against the indexed tree; linked URLs never cause outbound fetches. Markdown is returned as text.
- **Whose content.** An address serves only what is its repository's own: its branches, its tags, and the commits in the history of its default branch. A git host answers for more under the same name, such as the commits of forks and the heads of pull requests, which anyone can make ([ADR-0039](adr/0039-an-address-serves-only-what-is-the-repositorys-own.md)).
- **Fail closed.** No permission answer means no access. A repo that does not exist and a repo the caller may not see produce the same response after the same work: the git host is asked as the person before anything private is read, and no cache that a repository's own people fill is read for anyone else ([specs/permissions.md](specs/permissions.md)).
- **Tokens.** Git-host user tokens are encrypted at rest, used only to ask what their person can see, and never leave the server. Sessions, authorization codes, access and refresh tokens and client secrets are random strings stored as hashes. Our own access tokens are short-lived and good at one address. Tokens and authorization headers are never logged.
- **Requests that change something for a person** come from the deployment's own pages: the session cookie does not travel with other sites' requests, and the request's origin is checked as well.
- **Outbound requests.** Host adapters connect only to operator-configured base URLs, never to a URL taken from user input. The one exception is the metadata document an OAuth client identifies itself with: fetched over TLS from public addresses only, without redirects, small and briefly ([ADR-0036](adr/0036-the-deployment-is-the-authorization-server-of-its-addresses.md)).
- **Provenance.** Repos whose owner has verified them, or that the operator lists as ones it vouches for until owners can ([ADR-0019](adr/0019-the-operator-vouches-for-repositories-until-owners-can.md)), are *verified* on their default branch; responses from every other mount carry a provenance notice that warns about what the content says beyond the user's task. The operator's lists live in the database behind a token-protected admin API, and a repository on its blocked list answers like one that does not exist ([ADR-0026](adr/0026-serving-follows-the-license-and-the-operators-lists.md)).
- **Content policy.** The license a skill carries decides whether its content is served or only described with a link to the source ([ADR-0026](adr/0026-serving-follows-the-license-and-the-operators-lists.md)). The classification is pure logic in `core` over the same untrusted input as everything else; a text the reader does not know is restrictive. The index stores the resolved fact per skill and per repository, and the reader applies it with the mount's verification.
- **Operator content.** What the front page leads with and what the explorer features are the operator's, written through the admin API and kept in the database with the uploads they use; a fresh deployment shows the reference repository on both until the operator lists something ([ADR-0028](adr/0028-the-front-page-and-the-explorer-are-operator-content.md)). Media on the pages comes from the build or from those uploads, which are served by the hash of their bytes, and never from repository content. The terms of service and the privacy policy can be written the same way and are then served at `/terms` and `/privacy`, which every page links to before any configured URL ([ADR-0029](adr/0029-terms-and-privacy-pages-can-be-written-into-the-deployment.md)); their Markdown goes through the renderer repository content goes through.
- **Supply chain.** Lockfile with integrity hashes, a minimum release age for new dependency versions, an allow-list for install scripts, actions pinned by commit, secret scanning, and a provenance attestation on every published npm package ([ADR-0046](adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)); this repository publishes no images.

## Extension points

The business model is not in this codebase. What the code provides is structure that commercial and enterprise builds can attach to without forking:

- **Account** is the tenant unit and maps to a git-host organization or user, so the same model serves teams and individuals.
- **`Entitlements` port:** answers "may this account do X, and within what limits". The default implementation allows everything; the composition root wraps it with the operator's blocked list, which denies as if the repository did not exist. Enforcement points ask this port and never branch on a plan name.
- **`UsageSink` port:** receives neutral usage events (what happened, for which account, how much). The default implementation discards them.
- **`Embedder` port:** turns texts into vectors for the search by meaning, as documents or as a query ([ADR-0064](adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)). The one adapter speaks the common embeddings API that hosted and self-hosted servers share, keeps a few calls in flight at once and sheds a call that cannot start within its timeout, and leaves a server that keeps failing alone for a while.
- **`Reranker` port:** scores candidate texts against a query ([ADR-0065](adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)). The one adapter speaks the common reranking API in both of its spellings, bounded the same way.

## Delivery

Trunk-based development. Maintainers currently push directly to `main`; a pull-request gate comes later. CI runs on every push: lint, build, typecheck, tests, secret scan, and an image build that is then exercised. `main` is kept releasable: a deployment pins a green commit and builds the image from it. Publishing images and rolling them out happen outside this repository; [`deploy/README.md`](../deploy/README.md) defines the contract.

Seven packages are published to npm under the `@skillcdn` scope, `core`, `indexer`, `reader`, `client`, `serve`, `cli` and `brand`, at one shared version ([ADR-0058](adr/0058-the-published-packages-share-one-version.md)), each with its own changelog from changesets, published by the release workflow through the registry's trusted publishing, with provenance and no stored secret ([ADR-0046](adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)); `brand` carries the pictures of the brand under the trademark policy rather than the code's license ([ADR-0048](adr/0048-the-brand-files-are-a-package-of-their-own-under-the-trademark-policy.md)). The server has no version of its own: a deployment pins a commit.

Because old and new versions overlap during a rollout:

- migrations follow expand, then contract, across separate releases;
- public contracts (address scheme, tool names and schemas, skill URIs, REST) change additively unless an ADR defines a breaking transition; [ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md) records the pre-alpha path and tool replacement, and [ADR-0024](adr/0024-skills-travel-through-the-mcp-skills-extension.md) the last one.

## Observability

JSON logs to stdout: every line carries the role, the lines of a request its request id, and the lines of indexing and of a tool call the repository, the commit and the account id; never content or tokens. Metrics and tracing will attach through OpenTelemetry. Nothing vendor-specific lives in the code.
