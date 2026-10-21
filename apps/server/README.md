# @skillcdn/server

The single deployable. One build, one container image, several process roles ([ADR-0003](../../docs/adr/0003-one-image-several-roles.md)).

| Role | Command | Purpose | Status |
|---|---|---|---|
| `api` | `node dist/main.js api` | MCP over HTTP and the [REST API](../../docs/specs/rest.md), and, where it is configured, signing in, private repositories and the OAuth authorization server of the deployment's addresses ([permissions](../../docs/specs/permissions.md)). Where the deployment shares a secret with the git host's app, it also receives the host's events ([ADR-0038](../../docs/adr/0038-the-git-hosts-events-end-what-is-remembered.md)). Stateless. | implemented |
| `migrate` | `node dist/main.js migrate` | Apply pending database migrations, then exit. | implemented |
| `check` | `node dist/main.js check [directory]` | Read a directory as the indexer reads a commit and print what an agent would get: for repository authors, before they push ([convention](../../docs/specs/skill-repo.md), "Checking a repository before pushing"). Needs no database and no git host; exits with `1` when index diagnostics are present. The same code is the `skillcdn check` command of [`@skillcdn/cli`](../../packages/cli/README.md); the role stays for whoever has the image. From this checkout: `pnpm --filter @skillcdn/server run start check ../skills`. | implemented |
| `purge` | `node dist/main.js purge /gh/owner/repo` | Remove what was indexed for a repository: its snapshots, their index entries, its cached refs and the file bodies nothing references any more ([ADR-0026](../../docs/adr/0026-serving-follows-the-license-and-the-operators-lists.md)). Exits with `1` when the repository was never indexed. The same purge is `POST /admin/v1/purge/gh/owner/repo`. | implemented |
| `worker` | `node dist/main.js worker` | Run the jobs of the queue ([ADR-0064](../../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [deploy](../../deploy/README.md#the-worker)): index a repository on request, embed the sections of indexed commits where an embedder is configured and the database keeps vectors, and sweep hourly for what is served and not yet embedded under the configured model. Indexing ahead of requests, when a push arrives and on a schedule, is still to come; `api` indexes lazily until then, unless `INDEX_CONCURRENCY=0` leaves indexing to another process. | implemented for the jobs of the search by meaning |

## Running locally

```sh
docker compose -f deploy/compose.dev.yaml up -d    # PostgreSQL
cp .env.example .env                               # safe local defaults; add a GITHUB_TOKEN to raise the rate limit
pnpm build
pnpm --filter @skillcdn/server run start migrate
pnpm dev                                           # compiler in watch mode + api restarting on change
```

Then add `http://127.0.0.1:11188/gh/<owner>/<repo>` to an MCP client, or look at `src/api.int.test.ts` for a scripted session.

Signing in is off until it is configured, and nothing above needs it. To try it locally, register a GitHub App of your own as [`deploy/README.md`](../../deploy/README.md#signing-in-and-private-repositories) describes, with `http://127.0.0.1:11188` as its homepage and `http://127.0.0.1:11188/auth/gh/callback` as its callback, set its values, `AUTH_SECRET`, `PUBLIC_URL=http://127.0.0.1:11188` and `WEB_ROOT` (a build of the web UI, as [`.env.example`](../../.env.example) says) in `.env`. The tests need none of it: they sign people in through a fixture.

To see the web UI on top of this server, run `pnpm dev:web:api` next to it ([`apps/web`](../web/README.md)). Working on the UI alone needs none of this: `pnpm dev:web` runs it against fixtures, and `pnpm dev:web:live` against the hosted service.

### Without a container runtime

Docker is only the quickest way to get PostgreSQL. Any PostgreSQL 18 works; the server and the tests take a connection string and nothing else.

```sh
winget install PostgreSQL.PostgreSQL.18            # Windows
brew install postgresql@18 && brew services start postgresql@18    # macOS
```

Create a role that may create databases (the integration tests make one per test file) and a database for development, then point `DATABASE_URL` in `.env` at it. When your role or password differs from the defaults in `.env.example`, set `TEST_DATABASE_URL` in your shell as well, so that `pnpm check` finds the server.

```sql
create role skillcdn login createdb password 'choose-one';
create database skillcdn owner skillcdn;
```

## Layout

```
src/
  main.ts        role dispatch and exit codes; nothing else
  roles.ts       the list of roles
  config/        the only place that reads process.env; validates once at boot
  roles/         api.ts (composition root, HTTP server, shutdown), worker.ts (the queue's jobs until told
                 to stop), migrate.ts and purge.ts; the check role is main.ts handing a directory to
                 @skillcdn/indexer
  jobs/          the queues and their jobs (ADR-0064): what a job carries and in which order the queue
                 takes them (queues.ts), one slice of the embedding of a snapshot (embed-snapshot.ts),
                 the indexing of a repository on request (index-repository.ts), the sweep that backfills
                 and drops a replaced model (sweep.ts), what may be embedded under the scope and the
                 entitlements (scope.ts), when the api queues an embedding (triggers.ts), and the worker
                 wired to its ports (worker.ts), which the role and the tests run alike
  auth/          signing in and what follows from it (ADR-0035, ADR-0036): secrets.ts (sealing, token
                 making and hashing), login.ts (the round trip to the git host), sessions.ts,
                 credentials.ts (the person's token of the host, encrypted, renewed, forgotten when
                 lost), permissions.ts (whether a person can see a repository, as the host says),
                 repo-tokens.ts (the tokens people make for agents with nobody to sign in,
                 ADR-0040), and oauth/: the authorization server, its clients (registered, or a metadata
                 document fetched from the public internet only) and the rules for redirect URIs
  events/        what the git host says happened, applied to what is remembered (ADR-0038): refs
                 and names made due, answers forgotten, the index of a repository the app was taken
                 off removed
  janitor.ts     removes what time has ended: sessions, tokens, and answers of the git host that
                 nothing believes any more
  owners/        the page of an account (ADR-0037): the host's public listing, kept for a while,
                 with the indexed repositories that hold skills first
  http/          Hono app: /healthz, /readyz, the route that turns a URL into a mount, the REST API,
                 the admin API, the uploads of the showcase at /media/<sha>, what every request gets
                 (id, client address, access log), and web.ts, which serves a build of the web UI from
                 its manifest (pages per language, files, sitemap, robots), and through the build's
                 render module the page of an address, the page of an account, the front page with
                 the operator's showcase,
                 the deployment's own pages at /terms and /privacy, and the words of the social
                 preview of an address, drawn at /social/<address>; the owner's picture as the
                 icon of an address's MCP server at /icon/<address>; webhooks.ts receives the git
                 host's deliveries at /webhooks/gh; auth.ts registers everything
                 people sign in with: /auth/*, /api/v1/me/*, the consent page's two questions, and
                 the OAuth endpoints with their metadata
  operator/      the operator's lists, the landing showcase with its uploads, the pictures of
                 addresses, and the deployment's own pages (ADR-0026, ADR-0028, ADR-0029, ADR-0031)
  social/        the social preview of an address (ADR-0032): the card drawn with a canvas from the
                 words the web build writes, the owner's picture fetched for it and for the icon,
                 and both kept
  mcp/           the MCP surface of @skillcdn/serve over the deployment's reader, with what the deployment
                 counts of its use as the hooks the package offers (ADR-0057)
  mounts/        address -> repository and commit, through the database first and the git host second;
                 reader.ts composes the Reader of @skillcdn/reader over the index the database keeps (ADR-0054)
  indexer/       coordinates who indexes a commit (ADR-0007); the index itself is built by @skillcdn/indexer
  stats/         daily usage counters per public repository and for the deployment as a whole, with distinct clients by app: added up in memory, written in batches
  adapters/      implementations of core ports that are not their own package (clock, the embeddings
                 and reranking servers of the search by meaning behind the common inference APIs, and
                 meaning.ts, which wires them from the configuration the same way in every role)
  testing/       test support: a git host backed by fixtures/.repositories/, and the git host's side
                 of signing in for three made-up people (not compiled into dist)
```

Create directories when they get their first file. Do not add empty scaffolding.

## A request, end to end

1. `http/app.ts` parses the URL path with `parseAddress` and answers `400` for a malformed address. One segment short of an address is the page of an account for a browser, rendered with what the git host shows everyone.
2. `MountService` resolves the repository and the commit. Facts come from the database while they are fresh, from the git host otherwise, and from a slightly stale row when the host cannot be asked. A request from nobody in particular is resolved as everyone sees the name. Someone signed in (a session for the pages and the REST API, an access token or a repository token for MCP and the REST API) is answered the same way while the repository is known to be public. Otherwise it looks at what the host last let that person read, then asks the git host as everyone, then as that person, and reads what they can see through the app's installation; nothing one caller leaves behind answers another. Missing and forbidden repositories are one `404`, and for an MCP request without a token one `401` challenge; a public address never asks for a credential and publishes nothing about signing in ([permissions](../../docs/specs/permissions.md)).
3. Indexing of that commit starts in the background if nobody has done it ([ADR-0007](../../docs/adr/0007-snapshot-rows-coordinate-indexing.md)), or if what exists was built under older reading rules (`INDEX_VERSION` in `@skillcdn/indexer`). The indexer lists the tree, asks the blob store which bodies it lacks, and fetches those: through one archive download when there are several, per file otherwise. A body from the archive counts only when it hashes to what the tree says.
4. The `Reader` of `@skillcdn/reader` answers from the index ([ADR-0054](../../docs/adr/0054-the-reads-are-a-package-over-an-index-store-port.md)): what is there, one skill with the files it declares as needed on every run, one file, a search with a skill's files folded under the skill, and the manifests that could not be read. Where the deployment has an embedder and the database keeps vectors, a search also embeds its query, with recent queries' vectors remembered in the process, and fuses the sections nearest in meaning with the words' results, reranked where a reranker is configured ([ADR-0064](../../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)). The MCP tools and the REST routes of `@skillcdn/serve` render its answers, as text for a model and as JSON ([ADR-0057](../../docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)); the REST API never waits for the index.
5. The MCP handler builds a server for this one request, bound to the mount the route resolved for whoever the request is for ([ADR-0006](../../docs/adr/0006-mcp-sdk-v2-per-request-servers.md)); the access token stops at the route. `browse_repo`, `search_repo`, `load_skill` and the methods of the skills extension wait for the index within a budget; `read_repo_file` returns indexing until publication policy is known. Optional README introductions guide discovery, while complete skill and file text is paged to fit the MCP response budget ([tools](../../docs/specs/tools.md)).

## Process contract

- Exit codes: `64` for a usage error, `78` for invalid configuration, `70` for an internal failure or a role that is not implemented yet.
- `GET /healthz` is liveness. `GET /readyz` is readiness: database reachable, schema at least at the version this build ships, and not shutting down.
- `SIGTERM` or `SIGINT`: readiness fails, the listener stops accepting, requests in flight finish, unfinished indexing is handed back to the database, and the process exits within `SHUTDOWN_GRACE_SECONDS`.
- All configuration comes from the environment; see [`.env.example`](../../.env.example) and [`deploy/README.md`](../../deploy/README.md).

## Tests

- Unit tests next to the code.
- `src/api.int.test.ts` runs the real app against real PostgreSQL with the MCP client SDK and a git host backed by [`fixtures/.repositories/`](fixtures/.repositories/). It covers both protocol eras, sub-path mounts, hostile repositories, the indexing budget and the error surface. It needs the compose database, like the `db` integration tests.
- `src/rest.int.test.ts` does the same for the REST API and parses every response with the schemas in `@skillcdn/core`, which are what the web UI parses with.
- `src/roles/check.test.ts` runs the `check` role over the fixtures. The reading rules and what a working tree has that a git tree does not are tested in [`packages/indexer`](../../packages/indexer/README.md), next to that code.
- `src/web.int.test.ts` and `src/http/web.test.ts` cover serving a web build: language variants, the public origin, caching, the content security policy, the sitemap with the featured and the vouched-for repositories and the pages of their accounts, the front page and `llms.txt` rendered with the operator's showcase, the page of an account rendered with its data, and an address answering a browser with a rendered page and everyone else with MCP. They use a small fake build with a fake render module (`src/testing/web-build.ts`), not `apps/web`.
- `src/auth.int.test.ts` covers signing in and what a person then sees: the round trip, sessions, a private repository on the pages, over REST and over MCP for those the host lets see it and the same not-found for everyone else, the permission cache and its end, a lost credential, and the account routes. `src/oauth.int.test.ts` covers the authorization server: discovery, both kinds of client, the consent, codes, tokens bound to one address, rotation and reuse, revocation, the challenge, and a whole authorization driven by the MCP client SDK that ends with a tool call on a private repository. `src/owners.int.test.ts` covers the page of an account: no indexing on listing, indexed repositories first and once, nothing private, blocked or no longer public.
- `src/admin.int.test.ts` covers the admin API: the operator's lists, the showcase entries and the uploads they are made of (stored by hash, served immutably in byte ranges), and the takedown.
- `src/tokens.int.test.ts` covers the tokens people make for agents: made on the deployment's own pages, for a repository the person can open, with or without an end; an agent reads every address of that repository with one, nothing else, and loses it when it ends or its maker does. `src/connect.int.test.ts` covers a command connecting with a code a person approves (ADR-0059). `src/webhooks.int.test.ts` covers the receiver of the git host's events: what is refused unsigned, and what a delivery ends.
- `src/skills-extension.int.test.ts` covers what a host that implements the MCP skills extension gets (ADR-0024, ADR-0025). `src/mcp-discovery.int.test.ts` and `src/repository-layout.int.test.ts` cover discovery and loading over MCP: README introductions, hidden copies, exclusions, publication decisions before cold reads, paged results under the response budget, ancestor rules through whole-repository and nested mounts, shared pages, cursors bound to their request, and what a failed policy manifest withholds.
- `src/hybrid-search.int.test.ts` covers the search by words and by meaning over the document pack, with an embedder and a reranker in the process: a question in other words than the handbook's found by meaning with its section, the fusion of the two lists, the reranking of the first results, each layer left out when it does not answer, and the line and the field that say how a result was ranked.
- `src/worker.int.test.ts` covers the worker against the fixture host and an embedder in the process: a repository indexed on request and then embedded ahead of the rest, every section of a snapshot embedded once in slices that take turns on the queue, a slice tried again after the embedder failed, the sweep that backfills what is served and drops a replaced model's vectors once nothing is left, the api queueing the commits it indexes and the snapshots a search asks for, and what is not embedded: a repository out of the scope, one the entitlements refuse, the documents a manifest keeps to the words, and what lies past the bounds per repository and per account and day, with the usage events of what was.
- `src/memory-index.int.test.ts` holds the reader over an index in memory and over the index the database keeps to the same answers from the same fixture (ADR-0053, ADR-0054). `src/stats.int.test.ts` covers the usage statistics: what an MCP session and REST reads count, distinct clients by keyed hash folded when the day is over, the names of client apps, and writes that pile up or fail.
- `src/testing/harness.ts` wires the app for all of them. Every test file has a database of its own; tests inside a file share it.
