# Architecture

> **Status: design baseline.** Most of what is described here is not implemented yet; [roadmap.md](roadmap.md) tracks what exists. This document is kept current: when the implementation diverges from it, update it in the same change. Decisions with lasting consequences are recorded in [adr/](adr/).

## Overview

```
agent (any MCP client)
   |   https://<host>/gh/<owner>/<repo>[@ref][/path]
   |   anonymous for public repos; OAuth or a project token for private repos
   v
server, role api        stateless: MCP over HTTP, REST for the web UI, OAuth, webhook receiver
   |          \
   |           \ enqueue
   v            v
PostgreSQL <-- server, role worker      index and re-index on webhook or schedule
   |   content index (full-text), permission cache, job queue, later vectors
   v
blob cache (S3 API)     file bodies, keyed by content hash
   ^
git host                GitHub first; GitLab and Gitea behind the same port
```

Four properties shape everything else:

- **Git is the source of truth.** We read, index and serve. We never host content, and a pinned ref serves exactly what was reviewed.
- **The git host owns permissions.** We ask it whether a user can see a repo and cache only the yes/no answer. There is no user or team model of our own beyond a repo-scoped project token.
- **One image, one database.** Hosted and self-hosted run the same build against PostgreSQL and S3-compatible storage. Nothing in the core path needs a particular cloud.
- **Repositories declare, they never execute.** Skills are Markdown plus declarations. We run no third-party code, on the server or on the user's machine.

## Workspaces and boundaries

| Workspace | Responsibility | May import |
|---|---|---|
| `packages/core` | Address scheme, skill-repo convention, permission rules, tool contracts, and the ports everything else implements. Pure: no I/O, no Node APIs, usable in a browser. | nothing |
| `packages/db` | PostgreSQL schema, migrations, query layer. | `core` |
| `packages/github` | GitHub implementation of the git-host port: App auth, user tokens, contents, webhook verification. | `core` |
| `apps/server` | Composition root: configuration, HTTP and MCP surface, jobs, adapter wiring. | `core`, `db`, `github` |
| `apps/web` | Optional web UI: landing page and explorer, in several languages. Talks to `api` over REST only; builds to static files, prerendered per language ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md)). | `core` (types, schemas, address parsing) |

Where new things go:

- A new git host is a new package that implements the git-host port from `core`.
- The indexing pipeline, MCP handlers, job definitions and the S3 blob-store adapter start as modules inside `apps/server`. They move into a package when a second consumer appears, not before.
- Anything that needs the network, the clock, randomness or the environment is a port in `core` with an adapter elsewhere.

## Runtime: one image, several roles

`apps/server` builds into a single container image. The container command selects the role:

| Role | What it does | Scaling |
|---|---|---|
| `api` | Serves HTTP. Holds no state another replica needs. | Any number of replicas. |
| `worker` | Consumes the job queue and runs schedules. Jobs are idempotent and resumable, so a worker may be stopped at any moment. | Any number; interruptible capacity is fine. |
| `migrate` | Applies pending migrations, then exits. | Run once, before a new version rolls out. |
| `check` | Reads a directory as the indexer reads a commit and prints what an agent would get; for repository authors, before they push ([ADR-0020](adr/0020-a-check-role-reads-a-working-tree-with-the-indexer.md)). Needs no database and no git host. | Runs on an author's machine or in a repository's CI, then exits. |
| `purge` | Removes what was indexed for one repository, then exits ([ADR-0026](adr/0026-serving-follows-the-license-and-the-operators-lists.md)). The same purge is a route of the admin API. | Runs from an operator's shell when content must go. |

For a single-container install, a configuration flag lets `api` run the worker loop in-process.

Process contract: `GET /healthz` reports liveness, `GET /readyz` reports readiness (database reachable, schema at the expected version). On `SIGTERM` the process stops accepting work, drains what is in flight, releases unfinished jobs and exits within the grace period.

## Request paths

**Public repo.** Parse the address (`core`), resolve the repository and ref to a commit, and answer from the shared index for that `(repo, commit)`. An unknown repository or ref is a `404` at connect time. The first request starts indexing; `browse_repo`, `search_repo`, `load_skill` and the skills extension's methods wait within a budget, while `read_repo_file` returns the indexing state until the publication policy is known ([tools](specs/tools.md), [ADR-0023](adr/0023-optional-introductions-and-explicit-publication.md)). All content paths stay relative to the repository root. A sub-path mount clips the served set; it does not redefine identity or recompute reference reachability.

**A browser.** When the deployment serves the web UI, a `GET` that accepts HTML is answered with a page: a prerendered one for the static routes, in the language the `lang` parameter names, else the one the request's `Accept-Language` asks for ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md), [ADR-0021](adr/0021-a-url-without-a-language-is-served-in-the-language-asked-for.md)), and for an address a page rendered on the spot by the build's render module with what the address serves, the same answers the REST API gives ([ADR-0011](adr/0011-address-pages-rendered-on-the-server.md), [specs/rest.md](specs/rest.md)). Serving the page of an address resolves it and starts indexing, like the API. The server reads the build's manifest and knows nothing else about the UI.

**Private repo.** An org admin installs the GitHub App on selected repos (contents and metadata, read-only). A user connects through MCP OAuth; we hand off to the git host's login and keep the resulting user token server-side, issuing our own token to the agent. On every request we ask the git host whether this user can see this repo and cache the boolean for a short time; membership, team and visibility webhooks invalidate it. Indexing always uses the installation token. Headless agents use a **project token**: repo-scoped, read-only, expiring, revocable.

Details and open questions live in [specs/](specs/).

## Data and storage

PostgreSQL is the only stateful dependency and plays four roles: content index with full-text search, permission cache, job queue, and later vector search. Conceptual entities (the actual schema is documented in [`packages/db/README.md`](../packages/db/README.md)):

- **Account**: an organization or user on a git host. Everything tenant-scoped hangs off an account.
- **Repo**, **ref → commit** resolution, and **index entries** per `(repo, commit)`: canonical path, kind, front-matter, discoverability, readability, reference targets, search vector, blob hash, the digest and size of what the file is served as, and whether the skills extension lists a skill. Index entries for a commit are immutable. The reading-rule version invalidates indexes when interpretation changes.
- **Installation**, **project token** (stored as a hash), **git-host user token** (encrypted at rest), **permission cache** `(user, repo) → boolean` with an expiry.
- **Jobs**, owned by the queue library in its own schema.

Indexing first identifies declaration boundaries, then reads manifests and skills, discovers declared documents, and expands local Markdown references within bounded work. A failed manifest retains its boundary even when its body exceeds limits. Valid skills may declare hidden roots; individual links never expose siblings. Linked-only files are readable without becoming independent search results. Applicable rules are computed by ancestry and delivered completely through `load_skill` pages, including ancestor rules above a sub-path mount. These pages do not grant general reads outside the mount ([ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md)). A third round fetches every file of the skills the skills extension may list, so that each has a SHA-256 digest, and computes the digest of the document each listed skill is served as ([ADR-0025](adr/0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)).

**Usage statistics** are daily counters per public repository: connections, tool calls per tool, loads per skill, and distinct clients. Each `api` process adds up what it sees and writes the totals every few seconds with an additive upsert, so replicas need no coordination and a request never waits for a write. Distinct clients are told apart by a keyed hash of the client's address under a key that exists for one UTC day; when the day is over the hashes become a count and are deleted together with the key ([ADR-0010](adr/0010-distinct-clients-by-daily-keyed-hash.md)). The statistics store no address, user agent or other identifier, and repositories that are not public are not counted. The access log, which does record the client address and user agent of each request, is a separate log with its own switch ([deploy](../deploy/README.md)). The statistics feed rankings; they are not the `UsageSink` port, which carries metering events for whoever operates a deployment.

Identifiers are UUIDv7; timestamps are `timestamptz`. File bodies are stored as bytes under their git blob hash, which deduplicates across commits, refs and forks, and means a new commit only fetches what changed; text is derived from the bytes, so that what is served is what was digested. The blob-store port has a PostgreSQL implementation today, which keeps the smallest install at one dependency; bodies that do not belong in rows move to the S3 implementation of the same port.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript 7, ESM only. pnpm pins both itself and the Node.js runtime in the lockfile. |
| Monorepo | pnpm workspaces with a catalog, Turborepo, TypeScript project references. Packages compile to `dist/`. |
| HTTP | Hono on the Node.js adapter. |
| MCP | The official MCP TypeScript SDK, v2, over Streamable HTTP. One server instance per request, no sessions or selected-role state ([ADR-0006](adr/0006-mcp-sdk-v2-per-request-servers.md)). Four tools (`browse_repo`, `search_repo`, `load_skill`, `read_repo_file`) return text and structured data; one `use_skill(path)` prompt loads any exact skill. Connection instructions introduce folders ([ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md)). Skills also travel through the MCP skills extension `io.modelcontextprotocol/skills`, assembled from their sources and digested as served ([ADR-0024](adr/0024-skills-travel-through-the-mcp-skills-extension.md), [ADR-0025](adr/0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)). |
| Validation | Zod at every boundary. |
| Database | PostgreSQL 18: `tsvector` + GIN full-text search, JSONB, native `uuidv7()`; pgvector later. |
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

- **Immutable by construction.** Anything addressed by a commit hash never changes: index once per `(repo, commit)`, share it across all users, and send `Cache-Control: public, max-age=31536000, immutable` for cacheable reads of pinned public content.
- **Moving refs** (branches, tags, the default branch) get a short TTL and revalidate with the commit hash as the `ETag`.
- **Private responses** are always `Cache-Control: private, no-store`.
- **Be cheap toward the git host.** Conditional requests; one tree listing per commit; bodies fetched by content hash, so a new commit only costs what changed; one archive download instead of many per-file calls when a repository is new; webhooks instead of polling; backoff on rate limits. The host's request quota is the scarce resource, not bandwidth.
- **Bound the work per repo.** Text formats only, with caps on file count and size. Caps are configuration with safe defaults.
- **Stay small.** Stateless `api` and interruptible `worker` run on small arm64 instances and scale horizontally; one PostgreSQL covers search, queue and cache.
- The server honors forwarding headers only from a configured trusted proxy.

## Security model

- **Untrusted input:** repository content, every request, and webhook payloads until their signature is verified (constant-time comparison, replay protection on the delivery id).
- **No execution.** Repository content is parsed as data with size and depth limits, safe YAML, normalized paths, no traversal and no symlink following. Local Markdown references are resolved against the indexed tree; linked URLs never cause outbound fetches. Markdown is returned as text.
- **Fail closed.** No permission answer means no access. A repo that does not exist and a repo the caller may not see produce the same response.
- **Tokens.** Git-host user tokens are encrypted at rest and never leave the server. Project tokens are stored as hashes. Our own access tokens are short-lived. Tokens and authorization headers are never logged.
- **Outbound requests.** Host adapters connect only to operator-configured base URLs, never to a URL taken from user input.
- **Provenance.** Repos whose owner has verified them, or that the operator lists as ones it vouches for until owners can ([ADR-0019](adr/0019-the-operator-vouches-for-repositories-until-owners-can.md)), are *verified* on their default branch; responses from every other mount carry a provenance notice that warns about what the content says beyond the user's task. The operator's lists live in the database behind a token-protected admin API, and a repository on its blocked list answers like one that does not exist ([ADR-0026](adr/0026-serving-follows-the-license-and-the-operators-lists.md)).
- **Supply chain.** Lockfile with integrity hashes, a minimum release age for new dependency versions, an allow-list for install scripts, actions pinned by commit, secret scanning, and provenance plus SBOM attestations on published images.

## Extension points

The business model is not in this codebase. What the code provides is structure that commercial and enterprise builds can attach to without forking:

- **Account** is the tenant unit and maps to a git-host organization or user, so the same model serves teams and individuals.
- **`Entitlements` port:** answers "may this account do X, and within what limits". The default implementation allows everything; the composition root wraps it with the operator's blocked list, which denies as if the repository did not exist. Enforcement points ask this port and never branch on a plan name.
- **`UsageSink` port:** receives neutral usage events (what happened, for which account, how much). The default implementation discards them.
- **Extension registry** at the composition root: a build may register alternative port implementations and additional routes, modules and jobs. Such builds layer their own packages on top of this image; this repository has no knowledge of them.

## Delivery

Trunk-based development. Maintainers currently push directly to `main`; a pull-request gate comes later. CI runs on every push: lint, build, typecheck, tests, secret scan, and an image build that is then exercised. `main` is kept releasable: a deployment pins a green commit and builds the image from it. Publishing images and rolling them out happen outside this repository; [`deploy/README.md`](../deploy/README.md) defines the contract.

Because old and new versions overlap during a rollout:

- migrations follow expand, then contract, across separate releases;
- job payloads stay backward compatible for at least one release;
- public contracts (address scheme, tool names and schemas, skill URIs, REST) change additively unless an ADR defines a breaking transition; [ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md) records the pre-alpha path and tool replacement, and [ADR-0024](adr/0024-skills-travel-through-the-mcp-skills-extension.md) the last one.

## Observability

JSON logs to stdout with a request id, the account and the repo, and never content or tokens. Metrics and tracing will attach through OpenTelemetry. Nothing vendor-specific lives in the code.
