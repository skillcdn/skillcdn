# @skillcdn/server

The single deployable. One build, one container image, several process roles ([ADR-0003](../../docs/adr/0003-one-image-several-roles.md)).

| Role | Command | Purpose | Status |
|---|---|---|---|
| `api` | `node dist/main.js api` | MCP over HTTP and the [REST API](../../docs/specs/rest.md), and, where it is configured, signing in, private repositories and the OAuth authorization server of the deployment's addresses ([permissions](../../docs/specs/permissions.md)). Where the deployment shares a secret with the git host's app, it also receives the host's events ([ADR-0038](../../docs/adr/0038-the-git-hosts-events-end-what-is-remembered.md)). Stateless. | implemented |
| `migrate` | `node dist/main.js migrate` | Apply pending database migrations, then exit. | implemented |
| `check` | `node dist/main.js check [directory]` | Read a directory as the indexer reads a commit and print what an agent would get: for repository authors, before they push ([convention](../../docs/specs/skill-repo.md), "Checking a repository before pushing"). Needs no database and no git host; exits with `1` when index diagnostics are present. The same code is the `skillcdn check` command of [`@skillcdn/cli`](../../packages/cli/README.md); the role stays for whoever has the image. From this checkout, for one of the fixture packs: `pnpm --filter @skillcdn/server run start check fixtures/.repositories/multi-skill`. | implemented |
| `purge` | `node dist/main.js purge /gh/owner/repo` | Remove what was indexed for a repository: its snapshots, their index entries, its cached refs and the file bodies nothing references any more ([ADR-0026](../../docs/adr/0026-serving-follows-the-license-and-the-operators-lists.md)). Exits with `1` when the repository was never indexed. The same purge is `POST /admin/v1/purge/gh/owner/repo`. | implemented |
| `worker` | `node dist/main.js worker` | Run the jobs of the queue ([ADR-0064](../../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [deploy](../../deploy/README.md#the-worker)): index a repository on request, embed the sections of indexed commits where an embedder is configured and the database keeps vectors, and sweep hourly for what is served and not yet embedded under the configured model. It indexes packs ahead of the requests for them, when the git host announces a push and when a ref's time is up ([ADR-0085](../../docs/adr/0085-the-worker-indexes-a-pack-ahead-of-the-requests-for-it.md)); `api` indexes on request as before, unless `INDEX_CONCURRENCY=0` leaves indexing to another process. | implemented |

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
  jobs/          the queues and their jobs (ADR-0064, ADR-0072, ADR-0073, ADR-0085, ADR-0086): what a job carries and in which order
                 the queue takes them, by the repository's rank (queues.ts), one slice of the embedding
                 of a snapshot (embed-snapshot.ts), the indexing of a repository on request
                 (index-repository.ts) and ahead of requests, a pass and a look per repository
                 (index-ahead.ts), the hourly removal of the indexes nothing keeps (prune.ts), the pass
                 that keeps the copy of the entries searched across the packs (hub-entries.ts, ADR-0104), the sweep that puts what waits in order, backfills the ranked
                 repositories and drops a replaced model (sweep.ts), what may be embedded under the scope and the
                 entitlements (scope.ts), when the api queues an embedding (triggers.ts), what the operator
                 reads and asks of it through the admin API (reads.ts), and the worker wired to its
                 ports (worker.ts), which the role and the tests run alike
  auth/          signing in and what follows from it (ADR-0035, ADR-0036): secrets.ts (sealing, token
                 making and hashing), login.ts (the round trip to the git host), sessions.ts,
                 credentials.ts (the person's token of the host, encrypted, renewed, forgotten when
                 lost), permissions.ts (whether a person can see a repository, as the host says),
                 repo-tokens.ts (the tokens people make for agents with nobody to sign in,
                 ADR-0040), connections.ts (a command connecting with a code a person approves,
                 ADR-0059), pack-tokens.ts (the tokens an operator makes for the packs of the
                 deployment's own directory, ADR-0088), and oauth/: the authorization server, its clients (registered, or a metadata
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
                 icon of an address's MCP server at /icon/<address>; the badge of an address for
                 a README at /badge/<address>; crawlers.ts tells a crawler or
                 a link preview by its User-Agent, whose look starts nothing (ADR-0074);
                 webhooks.ts receives the git host's deliveries at /webhooks/gh; auth.ts registers everything
                 people sign in with: /auth/*, /api/v1/me/*, the consent page's two questions, and
                 the OAuth endpoints with their metadata
  operator/      the operator's lists, the landing showcase with its uploads, the pictures of
                 addresses, and the deployment's own pages (ADR-0026, ADR-0028, ADR-0029, ADR-0031);
                 entitlements.ts puts the blocked list in front of whatever else decides
  directory/     the packs of the deployment's own directory (ADR-0071): directory-host.ts reads
                 a working tree behind the git-host port, the hash of the tree as its commit
  search/        the search across every pack (ADR-0070): hub.ts answers it, by words and by
                 meaning; cache.ts keeps its answers for a while and bounds how many run at once
  retrieval/     what `eval:search` runs: the questions of the evaluation sets asked of an index
                 in memory, and the report of what they found (fixtures/retrieval/README.md)
  social/        the social preview of an address (ADR-0032): the card drawn with a canvas from the
                 words the web build writes, the owner's picture fetched for it and for the icon,
                 and both kept
  mcp/           the MCP surface of @skillcdn/serve over the deployment's reader, with what the deployment
                 counts of its use as the hooks the package offers (ADR-0057)
  mounts/        address -> repository and commit, through the database first and the git host second;
                 reader.ts composes the Reader of @skillcdn/reader over the index the database keeps (ADR-0054)
  indexer/       coordinates who indexes a commit (ADR-0007); the index itself is built by @skillcdn/indexer
  stats/         daily usage counters per public repository and for the deployment as a whole, with distinct clients by app: added up in memory, written in batches
  adapters/      implementations of core ports that are not their own package (clock), and meaning.ts,
                 which wires the embedding and reranking servers of the search by meaning from the
                 configuration to the adapters of @skillcdn/inference the same way in every role
  testing/       test support: a git host backed by fixtures/.repositories/, and the git host's side
                 of signing in for three made-up people (not compiled into dist)
```

Create directories when they get their first file. Do not add empty scaffolding.

## A request, end to end

1. `http/app.ts` parses the URL path with `parseAddress` and answers `400` for a malformed address. One segment short of an address is the page of an account for a browser, rendered with what the git host shows everyone.
2. `MountService` resolves the repository and the commit. Facts come from the database while they are fresh, from the git host otherwise, and from a slightly stale row when the host cannot be asked. A request from nobody in particular is resolved as everyone sees the name. Someone signed in (a session for the pages and the REST API, an access token or a repository token for MCP and the REST API) is answered the same way while the repository is known to be public. Otherwise it looks at what the host last let that person read, then asks the git host as everyone, then as that person, and reads what they can see through the app's installation; nothing one caller leaves behind answers another. Missing and forbidden repositories are one `404`, and for an MCP request without a token one `401` challenge; a public address never asks for a credential and publishes nothing about signing in ([permissions](../../docs/specs/permissions.md)).
3. Indexing of that commit starts in the background if nobody has done it ([ADR-0007](../../docs/adr/0007-snapshot-rows-coordinate-indexing.md)), or if what exists was built under older reading rules (`INDEX_VERSION` in `@skillcdn/indexer`); a crawler's look at a page starts nothing, and is shown what is indexed already ([ADR-0074](../../docs/adr/0074-a-crawlers-look-at-an-address-starts-nothing.md)). The indexer lists the tree, asks the blob store which bodies it lacks, and fetches those: through one archive download when there are several, per file otherwise. A body from the archive counts only when it hashes to what the tree says.
4. The `Reader` of `@skillcdn/reader` answers from the index ([ADR-0054](../../docs/adr/0054-the-reads-are-a-package-over-an-index-store-port.md)): what is there, one skill with the files it declares as needed on every run, one file, a search with a skill's files folded under the skill, and the manifests that could not be read. Where the deployment has an embedder and the database keeps vectors, a search also embeds its query, with recent queries' vectors remembered in the process, and fuses the sections nearest in meaning with the words' results, reranked where a reranker is configured ([ADR-0064](../../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)). The MCP tools and the REST routes of `@skillcdn/serve` render its answers, as text for a model and as JSON ([ADR-0057](../../docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)); the REST API never waits for the index.
5. The MCP handler builds a server for this one request, bound to the mount the route resolved for whoever the request is for ([ADR-0006](../../docs/adr/0006-mcp-sdk-v2-per-request-servers.md)); the access token stops at the route. `browse_repo`, `search_repo`, `load_skill` and the methods of the skills extension wait for the index within a budget; `read_repo_file` returns indexing until publication policy is known. Optional README introductions guide discovery, while complete skill and file text is paged to fit the MCP response budget ([tools](../../docs/specs/tools.md)).

## Process contract

- Exit codes: `64` for a usage error, `78` for invalid configuration, `70` for an internal failure.
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
- `src/admin.int.test.ts` covers the admin API: the operator's lists, the showcase entries and the uploads they are made of (stored by hash, served immutably in byte ranges), the takedown, and the search by meaning: how it stands, where the embedding went and what it took, a repository designated for indexing, and vectors imported against the stored bodies and the model in use.
- `src/tokens.int.test.ts` covers the tokens people make for agents: made on the deployment's own pages, for a repository the person can open, with or without an end; an agent reads every address of that repository with one, nothing else, and loses it when it ends or its maker does. `src/connect.int.test.ts` covers a command connecting with a code a person approves (ADR-0059). `src/webhooks.int.test.ts` covers the receiver of the git host's events: what is refused unsigned, and what a delivery ends.
- `src/skills-extension.int.test.ts` covers what a host that implements the MCP skills extension gets (ADR-0024, ADR-0025). `src/mcp-discovery.int.test.ts` and `src/repository-layout.int.test.ts` cover discovery and loading over MCP: README introductions, hidden copies, exclusions, publication decisions before cold reads, paged results under the response budget, ancestor rules through whole-repository and nested mounts, shared pages, cursors bound to their request, and what a failed policy manifest withholds.
- `src/hybrid-search.int.test.ts` covers the search by words and by meaning over the document pack, with an embedder and a reranker in the process: a question in other words than the handbook's found by meaning with its section, the fusion of the two lists, the reranking of the first results, each layer left out when it does not answer, and the line and the field that say how a result was ranked; and the search across the packs with both: the comparison by meaning asked once the words have answered and rested once it ran out of its time, and the answer by meaning alone, kept by no cache, when the words ran out of theirs; and a search while a commit just pushed waits to be embedded (ADR-0126): a skill under a new name first for its name, in its pack and across the packs, until the worker has embedded it.
- `src/worker.int.test.ts` covers the worker against the fixture host and an embedder in the process: a repository indexed on request and then embedded ahead of the rest, every section of a snapshot embedded once in slices that take turns on the queue, a slice tried again after the embedder failed, the sweep that backfills what is served and drops a replaced model's vectors once nothing is left, the api queueing the commits it indexes and the snapshots a search asks for, and what is not embedded: a repository out of the scope, one the entitlements refuse, the documents a manifest keeps to the words, and what lies past the bounds per repository and per account and day, with the usage events of what was.
- `src/index-ahead.int.test.ts` covers the worker indexing ahead of requests (ADR-0085), on a clock the tests move: a push the host announced looked at first and indexed without a request, a ref looked at again when its time is up for the repositories the scope names, a commit sent back for a rebuild, a repository that is no pack left to requests, a ref the host no longer has forgotten, the packs of the directory found on disk, a host that gives no answer left alone, and a look run from the real queue.
- `src/pack-tokens.int.test.ts` covers a deployment that reads the packs of its directory with a token only (ADR-0088): one answer for a pack and for a name that is nothing to a request that presents nothing, over REST, over MCP and on the pages; a token for one pack and for every pack, made, listed and removed through the admin API; a token ending at its time; nothing that lists what everyone is served naming such a pack; and the worker indexing the directory all the same.
- `src/retention.int.test.ts` covers which indexes are kept (ADR-0086): the commit a ref points at and the one before it whatever their age, a commit a ref moved on from and a pinned commit while they are read, the bodies nothing names any more removed with them, an index being built left alone, and a read noted at most once an hour.
- `src/memory-index.int.test.ts` holds the reader over an index in memory and over the index the database keeps to the same answers from the same fixture (ADR-0053, ADR-0054). `src/stats.int.test.ts` covers the usage statistics: what an MCP session and REST reads count, distinct clients by keyed hash folded when the day is over, the names of client apps, and writes that pile up or fail.
- The rest, each named for what it covers: `src/directory-packs.int.test.ts` (a deployment with a directory of packs), `src/hub.int.test.ts` and `src/hub-entries.int.test.ts` (the search across every pack, and the copy of the entries it reads), `src/index-now.int.test.ts` (what a person may ask of a repository's index), `src/serving.int.test.ts` (a moving ref whose newest commit is not ready) and `src/worker-rollout.int.test.ts` (a worker beside one of the build before). The evaluation of the search, `src/retrieval.test.ts`, `src/retrieval.int.test.ts` and `src/specification.test.ts`, is described with [its fixtures](fixtures/retrieval/README.md).
- `src/testing/harness.ts` wires the app for all of them. Every test file has a database of its own; tests inside a file share it.

## Rules

For whoever changes this workspace: read the root [`AGENTS.md`](../../AGENTS.md) first. This workspace is the composition root: it wires ports to adapters and exposes the product over HTTP.

- **Wiring here, logic elsewhere.** Domain rules belong in `@skillcdn/core`, SQL in `@skillcdn/db`, GitHub calls in `@skillcdn/github`. If a handler grows domain logic, move it down.
- **`src/config/` is the only reader of `process.env`** (lint enforces it). A new variable means: schema in the config module, an entry in `.env.example`, and a row in the table in `deploy/README.md`, all in the same change. Every tunable has a safe generic default; production values are never committed.
- **`api` is stateless.** No in-memory state that affects correctness, no sticky sessions, MCP transport in stateless mode. Sessions, grants and the git host's answers about people live in the database. An in-process cache is an optimization only, bounded, and keyed per repo and commit, never per user. The one thing remembered per person is a refusal: that a name was nothing to everyone and to them, for as long as an answer is believed. Nothing a person may see is ever held per person.
- **Every handler runs in this order:** validate input with a schema, check permission, then do the work. Responses for private content are `Cache-Control: private, no-store`. Unknown and forbidden repos produce the same response, after the same work, whoever else uses the name (`MountService.resolve`): ask the git host as the person before reading anything private, and never let a request read state that another caller's request wrote about a name, except that the name is a public repository, which is what the host tells everyone. A route that names repositories to everyone (a list, a card, a picture) resolves without a viewer, and shows nothing it cannot confirm is public now.
- **Tokens stop at the edge.** A session cookie or an access token is turned into a user by the route that received it, and nothing further in gets the credential. The git host's token of a person is read in `auth/credentials.ts` only, and handed only to the host adapter, only to ask.
- **An event of the git host ends what is remembered and establishes nothing** (ADR-0038). Never write down what a delivery says as a fact: make the fact due, forget the answer, and let the next request ask the host. Closing is the one exception: a repository said to be private or gone, a person said to have revoked the app. Whatever an event ends must end in the database, where every replica reads it.
- **A request that changes something for a person** checks that it comes from the deployment's own pages (`origin`), in addition to the session.
- **Errors are mapped at the edge.** Never forward an upstream error body, a stack trace or a token-bearing URL to a client.
- **Indexing is idempotent and interruptible.** A commit is claimed through its snapshot row and indexed once (ADR-0007); a claim that is interrupted is handed back, and the next request claims it again. Nothing assumes it runs exactly once.
- **Roles load their own weight.** Import role-specific heavy dependencies inside the role module so `migrate` does not pay for the HTTP stack.
- **Shutdown is part of the feature.** Anything long-running registers with the shutdown path, and tests cover it.
- **Logging:** structured logger only. Include the request id where there is a request, and the repository, commit and account id where the work is about a mount. Never log tokens, authorization headers or file content.
- **No business logic.** Limits and capabilities come from the `Entitlements` port and usage goes to `UsageSink`; never branch on plan names.

## Gotchas

- Integration tests in one file share a database, and the system is built to reuse what it knows: a repository is its host id, a commit is indexed once, a body is stored once per hash, a default branch is cached. A test that needs fresh state gives `createFixtureHost` a variant and addresses that variant's commit explicitly, and adds files of its own when it needs something to be fetched. What a request leaves behind outlives its test as well: the default branch of a repository stays where the last variant put it for as long as a ref is believed, a note that a name is nothing (`missing_repos`) answers the next test's question about that name, and what a fixture person made is still theirs. So a test that looks at a commit has a repository of its own, a test that counts questions to the host clears the notes first, and a test of what a person holds makes a person of its own.
- `snapshots.close()` aborts indexing and refuses new work; tests that only want to wait use `snapshots.idle()`.
- A write the server does not wait for lands after its response: the note that a grant or a session was used, as much as an index a request started. A test that reads such a thing back asks until it is there (`vi.waitFor`), never once. On the machine a test is written on the write usually wins the race; on CI the read came first, and the run failed.
- The crawler that draws a link's preview card sends `Accept: */*` or no `Accept` at all, never `text/html`. An address answers the page to any GET or HEAD that does not name what MCP speaks (`wantsHtml`); a rule that waited for `text/html` gave every unfurler the protocol's 405 and no card.
- A test of reads during indexing must hold only the indexer's tree request until the read assertions finish. Releasing a shared tree gate first lets the indexer race ahead and changes which read path is exercised.
- A commit is indexed once, and what its index holds is decided then. A change that would make an index come out differently (what is served, what is searched, how a document is summarized) needs `INDEX_VERSION` in `packages/indexer/src/build-index.ts` bumped in the same commit, with a changeset for the indexer; commits indexed under the older version are then rebuilt when next asked for. Without the bump, a deployment keeps serving what the old rules produced.

- The MCP SDK's handler gives the server factory a `Request` of its own making, not the object passed to `fetch`. Nothing can be handed to the factory by object identity: a `WeakMap` keyed by the request never matches. What the route resolved travels under a key the route makes up, in a header it sets itself and deletes afterwards (`http/app.ts`).
- A cache of "nothing by that name" that everyone reads is a side channel the moment a repository's own people can fill it: their visits made a stranger's first question about the name come back faster than a question about a name that is nothing, which says the repository exists and is in use. The memory of names that are nothing to the public is written only by requests from nobody in particular, a person's misses are kept for that person, in the process, and a no about a person is never stored in the database: the one table of names that are nothing (`missing_repos`) holds what requests from nobody found out, and nothing else. A test counts what the host is asked for both kinds of name (`auth.int.test.ts`, "answers an outsider after the same work").
- The authorization endpoint never answers a wrong request with a redirect to the client: registration is open to anyone, so that would make it a forwarder to any URL. And a redirect URI of an app's own scheme may write anything after the scheme, a well-known host included; what the consent page names as the recipient is the scheme.
- Clients do not agree on what makes a server one that wants a sign-in. Some wait for a `401`. Others look for the OAuth documents before they connect, at the well-known paths of the server's URL and then of the root of its origin, and sign in when they find one, even at a server that answers them without a credential. So a public address must have none of it: no challenge whatever it is sent, no protected resource metadata, and no authorization server metadata at the root of the origin, which is why the issuer has a path (`oauth.int.test.ts`, "shows no sign of signing in").
- Removing dot segments can turn a path into another site's host (`/.//host` reads as `//host`). A value that goes into a `Location` header is checked as it will be read, after parsing, not as it was written (`safeReturnTo`).
- Harnesses with a clock of their own share a database with harnesses on the system's time. A row one of them wrote "in the future" is read by the others, so whatever decides freshness by age must treat a negative age as not fresh (`Permissions.readable`); a real deployment has the same case when replicas' clocks differ.
- What the database remembers as public may no longer be: an anonymous look cannot tell a repository that went private from one that was deleted, and nobody may have looked since. Anything that shows repositories to everyone confirms with the host first (`MountService.publicRepository`), as the page of an account does, and compares the repository the host names with the one it holds: a name is given again to a new repository when the old one is deleted, and the row of the old one stays public in the database.
- Reading a mount starts indexing it: `SnapshotService.serving`, which every read of the reader goes through, makes and claims the commit's snapshot. A path that must start nothing, a crawler's look (ADR-0074), marks the mount `startsIndexing: false`; skipping `startIndexing` alone still indexes.
- The `commit` of a REST mount is the commit served, which is the one before while a ref's newest commit is not ready (ADR-0068); the newest is then in `newest`. A test of what an address resolves to compares `newest?.commit ?? commit`: one that compared `commit` after a push passed while the commit before was still being indexed, and failed on CI when it was not.

- `pnpm dev` runs the compiled output. If types look stale across packages, the root `dev:tsc` watcher is not running.
