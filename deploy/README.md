# deploy/

Everything needed to build the image and hand it to whatever runs it. This repository stops at an image that builds: publishing images, registries, deployment pipelines, infrastructure, DNS, TLS, CDN and rollout live outside it ([ADR-0008](../docs/adr/0008-repository-ends-at-an-image-that-builds.md)).

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | The one multi-stage image. Roles `api`, `worker`, `migrate`, `check` and `purge` are selected by the container command. |
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18 with the `vector` extension). Not a production topology. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container), secret scan, and an image build that is then exercised: exit codes, `migrate`, the `worker` taking the queue up and handing it back, readiness, non-root user, clean shutdown. It needs no secrets. Every commit on `main` keeps its own run, since any of them may be deployed and a deployment pinned to a commit waits for its verdict; on other refs a newer push cancels the run before it. |
| [`../.github/workflows/release.yml`](../.github/workflows/release.yml) | Versions and publishes the npm packages from the pending changesets: a pull request that bumps versions and changelogs, and, once it is merged, a publish through the registry's trusted publishing, with provenance and no stored secret ([ADR-0046](../docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)). |

A compose bundle and install script for self-hosting are planned ([roadmap](../docs/roadmap.md)).

## Build and run locally

```sh
docker build -f deploy/Dockerfile -t skillcdn .      # from the repository root
docker run --rm skillcdn migrate                     # one-off role
docker run --rm -p 11188:11188 --env-file .env skillcdn api
docker run --rm -v "$PWD:/repo:ro" skillcdn check /repo    # what an agent would get from this directory
```

The image runs as a non-root user, contains production dependencies only, and has no secrets and no configuration baked in. It carries the fonts of the web UI under their own license; see [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).

## Environment contract

The server is configured only through environment variables. [`.env.example`](../.env.example) is the source of truth; this table adds what operators need to know. Both are updated in the same change as the config module.

| Variable | Roles | Required | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV` | all | no | no | The image sets `production`. |
| `LOG_LEVEL` | all | no | no | Default `info`. |
| `HOST`, `PORT` | `api` | no | no | Defaults `0.0.0.0` and `11188`. |
| `SHUTDOWN_GRACE_SECONDS` | `api`, `worker` | no | no | Default `20`. Keep the platform's stop timeout above it. The worker gives its running jobs this long before it lets go of them. |
| `HTTP_KEEP_ALIVE_SECONDS`, `HTTP_REQUEST_TIMEOUT_SECONDS` | `api` | no | no | Defaults `65` and `60`. See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| `ACCESS_LOG` | `api` | no | no | Default `true`: one log line per request, probes excluded. Each line carries the client address and user agent: keep the log only as long as your privacy policy says, or turn it off. The usage statistics hold neither. |
| `TRUSTED_PROXIES` | `api` | no | no | Addresses or CIDR networks whose forwarding headers are believed. Default: none. |
| `CLIENT_IP_HEADER`, `REQUEST_ID_HEADER` | `api` | no | no | Defaults `x-forwarded-for` and `x-request-id`. Read only from trusted proxies. |
| `CLIENT_COUNTRY_HEADER` | `api` | no | no | The header in which a trusted proxy or CDN names the visitor's country (ISO 3166-1 alpha-2, or a subdivision as `US-CA`), which decides whether a page asks before analytics run ([ADR-0051](../docs/adr/0051-analytics-ask-first-only-where-the-visitors-region-asks-and-run-elsewhere.md)). Default: none, and every visitor is asked. Read only from trusted proxies. |
| `DATABASE_URL` | all | yes | **yes** | PostgreSQL connection string. The search by meaning keeps its vectors under the `vector` extension (pgvector): `migrate` creates the extension and its table where the server offers the extension and the role may create it, and otherwise logs the database's notice and makes neither, so that the search stays by words and everything else runs; the next `migrate` after the extension is installed makes them ([ADR-0064](../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)). `migrate` also installs the schema of the job queue, `pgboss`, which `api` and `worker` use without migrating ([the worker](#the-worker)). |
| `DATABASE_POOL_MAX` | `api`, `worker` | no | no | Default `10` connections per process. |
| `GITHUB_API_URL` | `api`, `worker` | no | no | Default `https://api.github.com`. GitHub Enterprise Server: `https://<host>/api/v3`. |
| `GITHUB_TOKEN` | `api`, `worker` | no | **yes** | Optional, no scopes needed. Raises the GitHub rate limit for public-repo reads; without it the anonymous limit applies to the whole deployment. |
| `GITHUB_WEB_URL` | `api` | no | no | Where people sign in at the git host. Default: derived from `GITHUB_API_URL` (`https://github.com`, or the origin of a GitHub Enterprise Server). |
| `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID` | `api` | no | no | The id and the client id of the GitHub App people sign in through. See [Signing in and private repositories](#signing-in-and-private-repositories). |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET` | `api` | no | **yes** | The app's private key in PEM format (a value with `\n` for line breaks is accepted; `GITHUB_APP_PRIVATE_KEY_FILE` is the natural way to mount one) and its client secret. |
| `GITHUB_APP_WEBHOOK_SECRET` | `api` | no | **yes** | The secret of the app's webhook, at least 32 characters. Set, the server receives the app's events at `/webhooks/gh`, verifies each against this secret, and ends what it remembers when they say so ([ADR-0038](../docs/adr/0038-the-git-hosts-events-end-what-is-remembered.md)). Unset: there is no such route, and what is remembered ends when its time is up. Read only together with the app's other variables. |
| `AUTH_SECRET` | `api` | no | **yes** | What the tokens of the git host are encrypted under at rest, and what requests in flight are sealed with. At least 32 characters, the same on every replica. Changing it signs everyone out. Signing in exists only when this and the four app variables are all set; setting some of them is a configuration error. |
| `SESSION_TTL_DAYS` | `api` | no | no | How long a browser stays signed in without being used. Default `30`. |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | `api` | no | no | How long an AI app's access token lasts, and how long it can renew it without the person. Defaults `3600` and `30`. |
| `PERMISSION_TTL_SECONDS` | `api` | no | no | How long the git host's answer about what a person can see is believed: someone removed at the host keeps access for at most this long. Default `60`; `0` asks on every request. |
| `WEB_ROOT` | `api` | no | no | Directory of a web UI build. The image sets `/app/web`; set it to an empty value to run without a UI. The build's render module runs inside the server, so only ever point this at a build made from this repository. |
| `PUBLIC_URL` | `api` | no | no | The origin visitors use, such as `https://skills.example.com`. Goes into canonical links, the sitemap and the URLs pages show. Unset: the origin of each request, which is right behind one hostname and wrong behind several; set it for any public deployment. Required for signing in: it is where the git host sends people back, the issuer of every token, and what the session cookie is bound to. |
| `ADMIN_TOKEN` | `api` | no | **yes** | Bearer token of the [admin API](#the-admin-api). At least 32 characters. Unset: the admin API does not exist. |
| `GOOGLE_SITE_VERIFICATION` | `api` | no | no | The content of the `google-site-verification` meta tag a search console asks for; written into the head of every page. |
| `GOOGLE_ANALYTICS_ID` | `api` | no | no | A Google Analytics measurement id (`G-...`). Set, the pages run analytics ([ADR-0051](../docs/adr/0051-analytics-ask-first-only-where-the-visitors-region-asks-and-run-elsewhere.md)): where the visitor's region asks first (`ANALYTICS_CONSENT_REGIONS`), and whenever the visitor could not be placed (`CLIENT_COUNTRY_HEADER`), a banner asks once and the script loads only after they agree; elsewhere it loads at once and the footer offers to turn it off; a browser that signals Global Privacy Control is never asked and never loads it. The script's consent mode starts denied in the regions that ask and granted elsewhere, advertising denied everywhere. The content security policy allows the script's sources and nothing else new. The pages send their own page views and the events of one funnel, naming only public repositories ([ADR-0050](../docs/adr/0050-the-pages-tell-analytics-only-what-is-public-and-usage-is-counted-in-the-database.md)); the property is set up to match, once ([below](#the-analytics-property)). |
| `ANALYTICS_CONSENT_REGIONS` | `api` | no | no | Where the pages ask before analytics run: a comma-separated list of regions (ISO 3166-1 alpha-2, or a subdivision as `US-CA`), `*` for everywhere, `none` for nowhere. Default: the European Economic Area, the United Kingdom and Switzerland. Matters only with `GOOGLE_ANALYTICS_ID`. |
| `TERMS_URL`, `PRIVACY_URL` | `api` | no | no | Where the deployment's terms of service and privacy policy are, when they are hosted elsewhere. A page written into the deployment through the [admin API](#the-admin-api) is served at `/terms` or `/privacy` and comes first ([ADR-0029](../docs/adr/0029-terms-and-privacy-pages-can-be-written-into-the-deployment.md)). Whichever exists is written into the head of every page as a standard link type and shown in the footer. See [Operating a public deployment](#operating-a-public-deployment). |
| `CONTACT_EMAIL` | `api` | no | no | Whom to write to about content: takedown requests and reports. Shown in the footer as a link, only when set. |
| `USAGE_STATS`, `USAGE_STATS_FLUSH_SECONDS` | `api` | no | no | Daily counts per public repository (connections, tool calls, skill loads, file reads, distinct clients) and for the deployment as a whole over every repository, public or not, which name no repository and count distinct clients by the app they named; without anything that identifies a client: addresses are hashed under the key of the day, and the rows of a day are folded into counts and deleted when it is over. Read through the [admin API](#the-admin-api). Defaults `true` and `15`. |
| `USAGE_HASH_SECRET` | `api` | no | **yes** | What client hashes are keyed from ([ADR-0027](../docs/adr/0027-client-hashes-are-keyed-from-a-configured-secret-and-the-day.md)); at least 32 characters. Unset, each process makes its own at start, and replicas or restarts within a day count a client more than once. Set it for more than one replica, or for exact counts. |
| `REPO_TTL_SECONDS`, `REF_TTL_SECONDS` | `api`, `worker` | no | no | How long repository facts and moving refs are trusted before revalidation. Default `60` each. |
| `INDEX_WAIT_MS` | `api` | no | no | How long a tool call waits for a new commit's index. Default `20000`. |
| `INDEX_CONCURRENCY`, `INDEX_LEASE_SECONDS` | `api`, `worker` | no | no | Commits indexed at once per process, and the lifetime of an indexing claim. `INDEX_CONCURRENCY=0` makes an `api` process index nothing and serve only what another process, on any version, has indexed; the `worker` indexes what it is asked to, one commit at a time at least. |
| `EMBEDDINGS_URL`, `EMBEDDINGS_MODEL` | `api`, `worker` | no | no | The embeddings server of the search by meaning ([ADR-0064](../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](../docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)): the endpoint of the common embeddings shape (`POST <url>` with `input` and `model`) and the model it serves, which the vectors are keyed by. Unset: nothing is embedded and the search is by words alone. Set, the `worker` embeds the sections of every indexed commit ([the worker](#the-worker)), `api` queues the commits it indexes for it, and a search embeds its query and fuses the sections nearest in meaning with the words' results ([words and meaning](../docs/specs/tools.md#words-and-meaning)); a query the server does not answer within `EMBEDDINGS_QUERY_TIMEOUT_MS` is answered by words alone, and the result says so. Give the two roles the same model: a worker embeds under its own, and leaves a job for another alone. |
| `EMBEDDINGS_SCOPE` | `api`, `worker` | no | no | Which repositories are embedded ([ADR-0064](../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)): `none` (the default), `public`, or `all`, which includes the private repositories the deployment serves, whose text then goes to the embedding server as well ([operating a public deployment](#operating-a-public-deployment)). Under `none` nothing new is embedded and a search by meaning finds what was embedded before. Read only with `EMBEDDINGS_URL`. Within the scope, the `Entitlements` port decides per repository and may bound the bytes embedded per repository and per account and day; the default allows everything without bounds, and a manifest may keep its documents out ([format](../docs/specs/skill-repo.md#the-repository-manifest-skillcdnmd)). |
| `EMBEDDINGS_DIMENSIONS` | `api`, `worker` | no | no | How many numbers every vector has. Default `1024`. A longer vector the model answers is cut to them and normalized, as the models of ADR-0065 allow; a model that answers fewer is the wrong model. A change of dimensions is a change of model, with a backfill. |
| `EMBEDDINGS_QUERY_INSTRUCTION` | `api` | no | no | The one-line task told to the model in front of a query, never of a document, as the instruction-tuned models take it (`Instruct: <task>` on one line, `Query:<text>` on the next). Default: none; the models of ADR-0065 lose a few points of retrieval without one. |
| `EMBEDDINGS_KEY`, `RERANKER_KEY` | `api`, `worker` | no | **yes** | Bearer tokens for the servers, when they want one. |
| `EMBEDDINGS_TIMEOUT_MS`, `EMBEDDINGS_QUERY_TIMEOUT_MS`, `RERANKER_TIMEOUT_MS` | `api`, `worker` | no | no | How long a call may take, waiting for its turn included: embedding documents (default `60000`), embedding a query (`5000`) and reranking (`5000`). A search whose query cannot be embedded or reranked in time is answered by words alone; a worker whose call fails tries the slice again later. |
| `EMBEDDINGS_CONCURRENCY`, `RERANKER_CONCURRENCY` | `api`, `worker` | no | no | Calls one process has in flight at once to each server; the rest wait their turn within their timeout, and a call that cannot start in time is not sent. Default `2` each: enough to keep a CPU server busy without a search queueing behind the batches of a worker. After three failures in a row a server is left alone for ten seconds, then asked once. The worker runs as many slices of embedding at once as this. |
| `EMBEDDINGS_BATCH_TEXTS`, `EMBEDDINGS_BATCH_CHARS`, `EMBEDDINGS_TEXT_CHARS` | `api`, `worker` | no | no | How sections are packed into one call, at most this many texts (default `16`) and this many characters over them (`32000`), and what a text is cut to before it is embedded (`8000`). The defaults suit a CPU server; a GPU takes more. Keep `EMBEDDINGS_TEXT_CHARS` within what the server takes as one input. |
| `RERANKER_URL`, `RERANKER_MODEL` | `api` | no | no | The reranking server of the search by meaning ([ADR-0065](../docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)): the endpoint of the common reranking shape (`POST <url>` with `query` and the candidates, spelled `documents` and `texts` both, answered with each candidate's `index` and its `relevance_score` or `score`) and its model. Optional beside the embeddings server: unset, the fused results are not reranked. |
| `RERANKER_CANDIDATES` | `api` | no | no | How many of the first results of a search the reranker scores before the page is cut, each by its title, heading path and the start of its best section. Default `10`, at most `32`: about what a CPU server scores within `RERANKER_TIMEOUT_MS`; a GPU takes more. |
| `INDEX_MAX_*`, `READ_MAX_FILE_BYTES` | `api`, `worker`, `check` | no | no | Limits on the work one repository may cause, including the unpacked size of a commit archive; see [`.env.example`](../.env.example). A file over `READ_MAX_FILE_BYTES` is not served: the skill is listed without it and names it with where to fetch it ([ADR-0033](../docs/adr/0033-a-file-over-the-read-limit-is-named-with-its-source.md)). The decision is made when a commit is indexed, so a changed limit shows after re-indexing. `check` and the `skillcdn check` command read these and nothing else. |

Invalid configuration stops the process with exit code `78` and a message that names the variable and the rule, never the value.

Every secret `NAME` may instead be provided as `NAME_FILE`, a path to a file holding the value, so secret mounts work. Secrets are injected at runtime by the platform (for example a task definition that references a secret store). They are never build arguments, image layers or committed files.

## The worker

The `worker` role runs the jobs of the deployment ([ADR-0064](../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)), kept by pg-boss in the database, in the schema `pgboss` that `migrate` installs. It takes the same environment as `api` and needs no port. One worker is enough; several share the queue, and a worker that is stopped hands its running jobs back within `SHUTDOWN_GRACE_SECONDS`.

```sh
docker run -d --env-file .env skillcdn worker
```

What it runs, first to last in the order the queue takes them:

- **A repository indexed on request.** An address is resolved as everyone sees the name, indexed if it is not, and its sections are then embedded ahead of everything else. `POST /admin/v1/embeddings/index/<address>` asks for it ([the admin API](#the-admin-api)), which also reads how the queues stand.
- **The sections of an indexed commit**, where `EMBEDDINGS_URL` is set, `EMBEDDINGS_SCOPE` admits the repository and the database has the `vector` extension: `api` queues every commit it indexes, and every snapshot a search by meaning asks for that was never embedded, at the lowest priority; the worker asks the scope and the `Entitlements` port again before it embeds, stops at the bounds they name, leaves out the documents a manifest keeps to the words, and embeds the Markdown documents and skills of the commit body by body, in slices of a few hundred sections, each slice a job of its own that goes to the back of the queue, so that a large pack takes turns with the others and a restart loses at most the body it was at. A body embedded once serves every commit, ref and fork that holds the same bytes. The embedder's calls stay within `EMBEDDINGS_BATCH_*`; a call that fails is tried again with a delay that doubles, and what was written stays.
- **The sweep**, once at start and every hour: the snapshots served right now, the ready index of the commit a ref points at, that have no complete embedding under the configured model are queued at the lowest priority. After a change of `EMBEDDINGS_MODEL` or `EMBEDDINGS_DIMENSIONS` that is every served snapshot, the backfill of ADR-0065; once nothing is left to embed under the new model, the vectors of the old one are dropped, and not before, so that a search never finds less than it did. To change the model: set the new one on `api` and `worker`, redeploy, and let the sweep run; nothing else.

Without `EMBEDDINGS_URL` the worker takes only the requests to index, and says so at start. With it and without the extension it says so and embeds nothing; so does `EMBEDDINGS_SCOPE=none`. Every slice adds the bytes, sections and tokens it embedded to the account's day, and tells the `UsageSink` port the tokens the model read, for whoever meters the deployment. The queue's own maintenance, the deletion of finished jobs after a week among it, runs in the worker as well.

## The admin API

The operator's lists and the takedown ([ADR-0026](../docs/adr/0026-serving-follows-the-license-and-the-operators-lists.md)) are managed through `/admin/v1`, which exists only while `ADMIN_TOKEN` is set and answers to nothing else than that token as a bearer token. Keep it off the public internet where you can: it is meant for an operator's shell, not for browsers. Every answer is JSON and never cached.

| Request | What it does |
|---|---|
| `GET /admin/v1/repositories[?kind=verified|featured|blocked]` | The lists, in the order entries were added. |
| `PUT /admin/v1/repositories/<kind>/gh/<owner>/<repo>[][/path]` | Adds an entry and answers with the address it was stored under. A `verified` or `blocked` entry names a repository, without a ref or a path; a `featured` one is any address. Adding what is already there changes nothing. |
| `DELETE /admin/v1/repositories/<kind>/gh/<owner>/<repo>[][/path]` | Removes an entry; `404` when there was none. |
| `POST /admin/v1/purge/gh/<owner>/<repo>` | Removes what was indexed for the repository: its snapshots, their index entries, its cached refs, and the file bodies nothing references any more. Answers with the counts, or `404` when the repository was never indexed. The next request for the repository indexes it again, unless it is blocked as well. |
| `GET /admin/v1/embeddings` | The search by meaning ([ADR-0064](../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md)): `configured`, the model, its dimensions, the scope and the reranking model, or `null` where it is not configured; `vectors`, whether the database keeps them; `pending`, the served snapshots within the scope without a complete embedding under the model; `queues`, each with `queued`, `active`, `failed`, `total` and `oldestWaitSeconds`, how long the oldest job ready to run has waited as of the queue's last pass; and `failures`, the jobs that failed for good, newest first, each with the `queue`, what the `job` carried, its `priority`, `attempts` and `error`. The last three are `null` where this process has no queue. |
| `GET /admin/v1/embeddings/repositories[?limit=]` | Where the embedding went, the most bytes first: per repository its `address`, `visibility`, `snapshots` with an embedding and how many are `completed`, and the `bodies`, `sections`, `bytes` and `tokens` they took, with `lastEmbeddedAt`. Private repositories are named here, to their operator. `limit` is up to 500, 50 unless said. Empty where the search by meaning is not configured. |
| `GET /admin/v1/embeddings/usage[?from=&to=]` | What was embedded per day over every account: `bytes`, `sections` and `tokens`, under the same `from` and `to` as the usage statistics. |
| `POST /admin/v1/embeddings/index/gh/<owner>/<repo>[@ref]` | Asks the worker to index the address now and embed it ahead of everything else, the designated indexing of ADR-0064. Answers `202` with the `address` and whether it was `queued`, false when the same address waits in the queue already; `400` for an address with a path; `503` where this process has no queue. The worker resolves the address as everyone sees it: a repository that is not public is not indexed this way. |
| `POST /admin/v1/embeddings/import` | Writes vectors computed elsewhere, for an operator who runs a model in bulk: a JSON body with the `model`, `dimensions` and `sectioningVersion` they were made under, which must be what the deployment embeds with, and `items`, up to 2,000, each the `blobSha` the index names a stored body by, the `section` index as the sectioning rules count it, its `heading` path, `offset` and `length`, and the `vector`. Answers with how many were `written` and how many were `skipped` as there already; `409` with `embeddings.other_model` for another key, `400` with `embeddings.unknown_bodies` for bodies not stored here, since a vector is reached only through an index entry, `503` where the search by meaning is not configured or the database keeps no vectors. The body may be up to 48 MiB. |
| `GET /admin/v1/showcase` | The entries the front page leads with ([ADR-0028](../docs/adr/0028-the-front-page-and-the-explorer-are-operator-content.md)), as `GET /api/v1/showcase` shows them to everyone. |
| `PUT /admin/v1/showcase/<id>` | Writes the entry named `<id>` (a lowercase slug) from a JSON body, replacing what was there; the body is described below. Answers with the entry as the pages read it, or `400` with `problems` that say what is wrong. |
| `DELETE /admin/v1/showcase/<id>` | Removes the entry. Its uploads stay. |
| `GET /admin/v1/images` | The pictures of addresses ([ADR-0031](../docs/adr/0031-a-picture-for-a-repository-comes-from-its-manifest-or-the-operator.md)): the address, the upload's hash or `null`, and the URL the pages load the picture from. |
| `PUT /admin/v1/images/gh/<owner>/<repo>[@ref][/path]` | Gives the address a picture, replacing what was there, from a JSON body with exactly one of `media` (the hash of an upload that is a picture) and `url` (an `https` URL). The explorer's card and the page of that address, and of every address of that repository when the picture is the repository's, show it in place of what the repository's manifest declares. A URL keeps the picture's traffic off the deployment; an upload is served from it. |
| `DELETE /admin/v1/images/gh/<owner>/<repo>[@ref][/path]` | Removes the picture; `404` when there was none. The repository's own picture, when it declares one, shows again. |
| `GET /admin/v1/media` | The uploads: hash, type, size, URL, and which entries and addresses use each. |
| `POST /admin/v1/media` | Stores the request body as an upload of the `content-type` sent: `video/mp4`, `video/webm`, `image/avif`, `image/webp`, `image/png`, `image/jpeg` or `image/gif`, at most 16 MiB. Answers with its `sha`, the SHA-256 of the bytes, and the `url` it is served at for everyone, `/media/<sha>`, immutably. The same bytes are the same upload. |
| `DELETE /admin/v1/media/<sha>` | Removes an upload; `409` while an entry or the picture of an address uses it. |
| `GET /admin/v1/legal` | The deployment's own pages that have been written ([ADR-0029](../docs/adr/0029-terms-and-privacy-pages-can-be-written-into-the-deployment.md)): its terms of service and its privacy policy. |
| `PUT /admin/v1/legal/<kind>` | Writes the page of `<kind>` (`terms` or `privacy`) from a JSON body, replacing what was there: `texts` by language tag, each with a `title` and a `body` in Markdown, and an optional `revised` date (`YYYY-MM-DD`). The page is then served at `/terms` or `/privacy` on the deployment's own origin, and every page links to it. |
| `DELETE /admin/v1/legal/<kind>` | Removes the page. The configured URL, when there is one, is linked again. |
| `GET /admin/v1/usage[?from=&to=]` | The usage statistics ([architecture](../docs/architecture.md)) of the deployment as a whole, per day: `items` of `day`, `metric` (`connection`, `tool_call`, `skill_load`, `file_read`, `client`, `client_app`), `subject` (the tool, or the REST route as `rest/<route>`; the name of the client app; or empty) and `count`. Every read of the statistics takes `from` and `to`, days as `YYYY-MM-DD` in UTC, both included and at most 366 apart; left out, the last thirty days. |
| `GET /admin/v1/usage/repositories?metric=[&from=&to=&limit=]` | The public repositories with the highest total of one metric (`connection`, `tool_call`, `skill_load`, `file_read`, `client`), most first: `address`, with `host`, `owner` and `name` as the host spells them, and `count`. `limit` is up to 500, 50 unless said. |
| `GET /admin/v1/usage/subjects?metric=[&from=&to=&limit=]` | The subjects of one metric (`tool_call`, `skill_load`, `file_read`) with the highest totals across public repositories, each with its repository as above and its `subject`: the most loaded skills by directory, the most read files by path, the most called tools and REST routes. |
| `GET /admin/v1/usage/gh/<owner>/<repo>[?from=&to=]` | What was counted for one public repository, summed over the days: `items` of `metric`, `subject` and `count`. `404` for a repository that is unknown or not public, which read the same. |

What the lists do: a `verified` repository carries no provenance notice on its default branch; a `featured` address is shown by the explorer, and while there is none the reference repository of this project is; a `blocked` repository answers exactly like one that does not exist. The sitemap lists the featured addresses and the verified repositories, minus anything blocked. A process sees a change made through another process within thirty seconds.

```sh
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" https://skills.example.com/admin/v1/repositories/blocked/gh/owner/repo
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://skills.example.com/admin/v1/purge/gh/owner/repo
```

The same purge runs without the API, from a shell with the database configured: `node dist/main.js purge /gh/owner/repo`.

What the front page leads with is the showcase: a list of entries the operator writes, each a card with media and words, in order. Until the operator writes one, the page shows the build's own showcase of the reference repository. Upload the media first, then write the entry that names it:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: image/webp" --data-binary @poster.webp https://skills.example.com/admin/v1/media
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: video/mp4" --data-binary @clip.mp4 https://skills.example.com/admin/v1/media
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" --data @entry.json https://skills.example.com/admin/v1/showcase/spring-ad
```

An entry is a JSON document:

- `address`: where the card leads, any address such as `/gh/owner/repo` or `/gh/owner/repo@main/skills/ad`.
- `position`: its place in the list, lowest first; `0` when left out.
- `width` and `height`: the pixel size of the clip and its poster.
- `media`: uploads by hash. `poster` is required; `clip` (a video), `animation` (the clip as an animated image, for browsers that will not play video), `reference` and `picture` (what the example conversation attaches) and `social` (a 1200 x 630 picture for link previews) are optional. A `clip` needs `durationMs`, one pass of it, and `published`, its date as `YYYY-MM-DD`.
- `texts`: the words by language tag (`en`, `ko`), at least one language. Each has `title`, `body` and `action` (the button), and optionally `tags` (up to four), `requirement` (what the skill needs besides the AI app), `clip` (what the clip shows, for whoever cannot see it), `credit`, and `demo`, the example conversation: `prompt` (what the person asks, with the `picture` and `reference` attached, captioned by those two words, when the entry has that media), the assistant's `question`, the person's `answer`, the assistant's `plan`, the `approval` line that says the plan and the estimate were reviewed, the person's `consent`, `working` (said over the result while it is made) and `result` (what the result is, in one line, for whoever cannot see it). A visitor is shown their language, else the default language of the pages; an entry without a `demo` in the visitor's language shows the build's own conversation.

```json
{
  "address": "/gh/owner/repo",
  "width": 752,
  "height": 560,
  "durationMs": 9500,
  "published": "2026-10-01",
  "media": { "poster": "<sha of poster.webp>", "clip": "<sha of clip.mp4>" },
  "texts": {
    "en": {
      "title": "The ad you love, with your star in it.",
      "body": "Show it an ad you admire and a picture of your product.",
      "tags": ["A video and a picture in", "Ready to post"],
      "action": "Make something like this"
    }
  }
}
```

A repository declares its own picture in its manifest ([format](../docs/specs/skill-repo.md#the-repository-manifest-skillcdnmd)). To show another one on a repository's card and page, give its address a picture: an `https` URL, or an upload from `POST /admin/v1/media`.

```sh
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" --data '{"url":"https://example.com/pictures/skills.png"}' https://skills.example.com/admin/v1/images/gh/owner/repo
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" --data '{"media":"<sha of banner.webp>"}' https://skills.example.com/admin/v1/images/gh/owner/repo@main/skills/ad
```

The deployment's own pages take the same shape in miniature. Writing them here keeps their URLs on your own origin, `/terms` and `/privacy`, which is what the head, the footer and the consent banner then link to; `TERMS_URL` and `PRIVACY_URL` are for pages hosted elsewhere. A visitor reads their language, else the default language of the pages.

```sh
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" --data @terms.json https://skills.example.com/admin/v1/legal/terms
```

```json
{
  "revised": "2026-10-01",
  "texts": {
    "en": { "title": "Terms of service", "body": "## Scope\n\nThese terms govern ..." },
    "ko": { "title": "이용약관", "body": "## 적용 범위\n\n이 약관은 ..." }
  }
}
```

## Signing in and private repositories

Without the variables below a deployment serves public repositories to everyone and knows nobody. With them, people sign in with their GitHub account, open the private repositories GitHub lets them see, and connect their AI apps to them ([specs/permissions.md](../docs/specs/permissions.md)). It needs the web UI (`WEB_ROOT`, which the image sets) and `PUBLIC_URL`, over TLS for anything but local development.

Register a **GitHub App** (not an OAuth app) under the account that operates the deployment:

| Setting | Value |
|---|---|
| Homepage URL | `PUBLIC_URL` |
| Callback URL | `PUBLIC_URL/auth/gh/callback` |
| Expire user authorization tokens | On. The server renews them. |
| Request user authorization (OAuth) during installation | Off. People sign in from the deployment's own pages; an authorization that starts at GitHub is not one this server asked for and is refused. |
| Setup URL | `PUBLIC_URL/account/repositories`, with "Redirect on update" on, so that whoever installs the app comes back to the page that lists what they can now open. |
| Webhook | Active, with the URL `PUBLIC_URL/webhooks/gh` and a secret of your making (`openssl rand -base64 48`), which is also `GITHUB_APP_WEBHOOK_SECRET`. Not active: the server receives nothing, and everything it remembers ends when its time is up. |
| Subscribe to events | Push and Repository. What the app is told about installations and revoked authorizations comes without subscribing. |
| Repository permissions | Contents: read-only. Metadata: read-only. Nothing else, and no account permissions. |
| Organization permissions | None: reading needs no more, and an app should hold nothing it can do without. A change of collaborators, teams or members then takes effect within `PERMISSION_TTL_SECONDS`. An operator who wants it at once adds Members: read-only, with the events Member, Membership, Team, Team add and Organization, and has to decide that before accounts install the app: a permission added later has to be accepted again by every account that installed it, and does not apply to an installation until it is. |
| Where can this GitHub App be installed? | Any account for a deployment open to others; only this account for a private one. |

Then set `GITHUB_APP_ID` and `GITHUB_APP_CLIENT_ID` from the app's page, generate a client secret for `GITHUB_APP_CLIENT_SECRET` and a private key for `GITHUB_APP_PRIVATE_KEY`, and make up `AUTH_SECRET` (`openssl rand -base64 48`). On GitHub Enterprise Server, `GITHUB_API_URL` names the installation and the app is registered there.

What then happens, and what to know when operating it:

- A person signs in from the deployment's own pages, and every time GitHub shows its account picker first, so that they see which account they continue with before they are back ([ADR-0042](../docs/adr/0042-every-sign-in-passes-the-git-hosts-account-picker.md)). Nothing is configured for it.
- An owner installs the app on the repositories it may read. A person signs in, and the server asks GitHub, as that person, whether they can see a repository; content is read with the app's installation token, never with a person's. A private repository without the app installed is not found, for its members too.
- The person's GitHub token is stored encrypted under `AUTH_SECRET` and used for nothing but asking. Sessions, authorization codes and the tokens of AI apps are stored as hashes. `AUTH_SECRET` is the one value to guard: keep it with your other secrets, the same on every replica.
- `PERMISSION_TTL_SECONDS` is the staleness bound for whatever the git host does not announce. With the webhook active, a push is served by the next request, a repository made private or deleted closes at once, a person who revokes the app is signed out, and taking the app off a repository that is not public removes what was indexed of it. GitHub does not send a failed delivery again by itself: the lifetimes cover a delivery that never arrived, and an operator can send one again from the app's settings for a few days.
- A delivery only ever ends what is remembered, so the receiver needs no protection beyond the signature: an unsigned request is refused after one hash over at most 4 MiB, and a signed one that is sent twice makes the server ask GitHub again.
- The deployment is the OAuth authorization server of its own addresses: `/.well-known/oauth-authorization-server/oauth`, `/.well-known/oauth-protected-resource/...`, `/oauth/*` and `/auth/*` have to reach the server, like `/gh/*`. Serve nothing of your own at `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration` or `/.well-known/oauth-protected-resource`: the server leaves them empty on purpose, so that a public address looks to every client like one that needs no sign-in. AI apps register themselves; a registration grants nothing until a person agrees on the consent page. `POST /oauth/register` is the one place where anyone can write a row: the server keeps the number of unused clients bounded and removes them after a week, and limiting how fast one client can ask is for what you put in front, as for every other anonymous endpoint.
- A person can make a token for an agent that has nobody to sign in: a scheduled job, a server ([ADR-0040](../docs/adr/0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md)). It reads one repository, as that person, until it expires or they remove it, and it is checked against GitHub like every other request of theirs. Nothing is configured for it. A proxy in front has to pass the `authorization` header of such an agent through, as it does for an app that signed in.
- To read an app's metadata document the server makes one kind of request to a URL somebody else chose: over TLS, to public addresses only. An installation without outbound internet access still works with the apps that register themselves instead.
- A process removes expired sessions, codes, tokens and stale answers on its own, every quarter of an hour; nothing has to be scheduled.

## Operating a public deployment

Everything above suits a private installation as it comes. A deployment that serves other people's repositories to the public has more to say and to answer for. Before opening one up:

- Set `PUBLIC_URL` to the origin visitors use, so that canonical links and the sitemap are yours.
- Publish terms of service and a privacy policy: write them into the deployment through the [admin API](#the-admin-api), which serves them at `/terms` and `/privacy` in every language you write them in, or host them elsewhere and set `TERMS_URL` and `PRIVACY_URL`. Set `CONTACT_EMAIL` to an address that reads takedown requests and content reports. The pages show all three in the footer and carry them in the head. Where people sign in, the button they sign in with says under it that continuing agrees to the terms and the privacy policy, each where you have one, so have them in place before you let people in: the first sign-in is what makes an account.
- Know what the service does with content, and say it where your visitors can read it: it reads, indexes and serves what a repository publishes, keeps copies only to serve them, and serves or describes a skill by the license it carries ([format](../docs/specs/skill-repo.md#licenses)). A takedown is one entry on the blocked list and one purge through the [admin API](#the-admin-api); keep `ADMIN_TOKEN` where only the operator can reach it.
- Decide what you vouch for. A `verified` repository is served in full on its default branch whatever its license says, and carries no provenance notice: put only repositories there whose owners agreed.
- Analytics ask first where the visitor's region asks, and run elsewhere with the footer offering to turn them off ([ADR-0051](../docs/adr/0051-analytics-ask-first-only-where-the-visitors-region-asks-and-run-elsewhere.md)); name the header your proxy or CDN sets with the visitor's country in `CLIENT_COUNTRY_HEADER`, or every visitor is asked. Say in your privacy policy what `GOOGLE_ANALYTICS_ID` sends where, that analytics run unless the visitor is asked first or turns them off in the footer, and that a browser signaling Global Privacy Control is left alone; or leave it unset. What the pages send names no repository that is not public and nothing a visitor typed ([ADR-0050](../docs/adr/0050-the-pages-tell-analytics-only-what-is-public-and-usage-is-counted-in-the-database.md)), and the property is set up to match, once ([below](#the-analytics-property)). The banner asks for analytics and nothing else: advertising would be a consent of its own.
- The access log (`ACCESS_LOG`) holds client addresses. Give it a retention that your privacy policy states, or turn it off. The usage statistics hold none: set `USAGE_HASH_SECRET` so that distinct clients count once across replicas, and keep it with your other secrets (ADR-0027).
- Put TLS, caching and rate limiting in front of the image ([below](#behind-a-reverse-proxy)), and a token without scopes in `GITHUB_TOKEN` so that the anonymous rate limit of the git host is not what your visitors get. The page of an account lists from the git host on behalf of whoever opens it, search engines included, which is one more reason for the token.
- Where the search by meaning is on (`EMBEDDINGS_URL`), the text of every document embedded leaves the image for the embedding server you run, and a query does too ([ADR-0064](../docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](../docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)): say in your privacy policy where that server runs and that the text goes no further. `EMBEDDINGS_SCOPE=public` keeps private repositories out of it; `all` sends their text too, so set it only where the server is yours and the people whose repositories they are know. A repository keeps its documents out with `search: { meaning: false }` in its manifest.
- Where people sign in ([above](#signing-in-and-private-repositories)), say in your privacy policy what is kept about them: their account's id, name and login at the git host, the encrypted token, their sessions, which apps they allowed to read which address, and the tokens they made for their agents, as hashes. Signing out ends a session; removing an app ends its access; when GitHub stops vouching for a person, everything of theirs is deleted.

## The analytics property

With `GOOGLE_ANALYTICS_ID` set, the pages send their own page views and the events of one funnel, naming only what is public ([ADR-0050](../docs/adr/0050-the-pages-tell-analytics-only-what-is-public-and-usage-is-counted-in-the-database.md); the events and their parameters are listed in the [web UI's README](../apps/web/README.md#analytics)), and a visitor is asked first only where their region asks ([ADR-0051](../docs/adr/0051-analytics-ask-first-only-where-the-visitors-region-asks-and-run-elsewhere.md)). The property has to be set up to match, once:

1. **Enhanced measurement.** Turn off *Page changes based on browser history events*: the pages count their own page changes, and with it on every page is counted twice, the second time with the raw URL and title. Turn off *Site search*: it reads the search term out of the URL. The rest (scrolls, outbound clicks, file downloads, video, forms) may stay on.
2. **Custom dimensions**, event-scoped, one per parameter the pages send: `view`, `visibility`, `outcome`, `skill`, `site_language`, `kind`, `id`, `client`, `method`, `from`, `approved`. Without them the parameters arrive but cannot be reported on.
3. **Key events.** Mark `connect_start`, `login`, `token_create` and `app_consent` as key events: they are the funnel's conversions.
4. **No advertising.** Leave Google signals and ads personalization off, and link no advertising account: the consent the pages ask for is for analytics only, and the consent mode denies advertising storage everywhere. Advertising would be a consent of its own, with new words in the banner.
5. **Data retention and the privacy policy.** Choose the retention your privacy policy states, and say in it what is sent: page views as public addresses or stand-ins, the events, and nothing a visitor typed; that visitors in the regions that ask are asked first; that elsewhere analytics run until turned off in the footer's cookie settings; and that a browser signaling Global Privacy Control is left alone.
6. **Check it.** In the property's DebugView, from a browser with the debugging extension: the `page_location` of a `page_view` is the address of a public repository or `/gh/-/-`, never a private name; `/oauth/consent` arrives without its query and `/connect/<code>` as `/connect`; a search arrives as the address with `view` set to `search` and no term; the connection guide's install and copy actions send `connect_start`; and a visitor placed outside the regions that ask sees no banner and sends from the first page.

## Behind a reverse proxy

The `api` role speaks plain HTTP and expects TLS, caching and per-client rate limiting to happen in front of it. What the server needs to know about that front:

- **Who the proxies are.** List their addresses or networks in `TRUSTED_PROXIES`. Forwarding headers are believed only when the peer on the socket is on that list; from anyone else they are ignored, because anyone can send them. With `x-forwarded-for` the client is the nearest address in the chain that is not a trusted proxy. If your proxy passes the client address in a header of its own, name it in `CLIENT_IP_HEADER`; it is then read as a single address. Make sure the proxy overwrites that header instead of passing on what the client sent.
- **Request ids.** A trusted proxy's id (`REQUEST_ID_HEADER`) is adopted; otherwise the server makes one. Either way it is in every log line of the request and in the `x-request-id` response header, so a report from a user can be matched to the logs.
- **Where visitors are.** If your proxy or CDN adds a header with the visitor's country, name it in `CLIENT_COUNTRY_HEADER`: it decides whether a page asks before analytics run ([ADR-0051](../docs/adr/0051-analytics-ask-first-only-where-the-visitors-region-asks-and-run-elsewhere.md)), and is read only from trusted proxies, like the address. Make sure the proxy overwrites it rather than passing on what the client sent; a visitor it could not place, or sent no header for, is asked.
- **Idle connections.** Keep `HTTP_KEEP_ALIVE_SECONDS` above the idle timeout of the proxy. When the server closes an idle connection first, the proxy occasionally sends a request into it and answers its client with a gateway error.
- **Slow answers.** A tool call may wait up to `INDEX_WAIT_MS` for an index. The proxy's response timeout has to be longer than that.
- **Streaming.** MCP responses may be event streams. Do not buffer or transform `text/event-stream` responses.
- **Cross-origin calls.** The REST API under `/api/` and the MCP endpoint under `/gh/` answer browsers on any origin by themselves: pass `OPTIONS` requests and `access-control-*` headers through.
- **Events.** Where the app's webhook is active, `POST /webhooks/gh` has to reach the server from the git host, with bodies of up to 4 MiB and without anything in front asking for a credential: the server verifies the host's signature itself, over the body exactly as it arrived, so nothing in front may rewrite it.
- **Credentials.** Where people sign in, pass `cookie`, `set-cookie`, `authorization` and `www-authenticate` through untouched, and never cache a response that says `private` or `no-store`: the page and the answers of a private repository are one person's. Pass the browser's `sec-fetch-site` request header through as it came, too: by it the server tells a sign-in begun on its own pages from a link that was followed from somewhere else, which it only offers to sign in ([ADR-0041](../docs/adr/0041-a-sign-in-begins-on-a-page-of-the-deployments-own.md)). A `/gh/...` path answers differently with and without a session, which the response says with its own cache headers rather than with `Vary`; a cache must revalidate, as the page asks.
- **Pages.** With a web UI, set `PUBLIC_URL`. A page URL with the `lang` query parameter, and every file, has exactly one representation and may be cached by URL, query string included. A page URL without the parameter is answered in the language the request's `Accept-Language` asks for, else the default, and says `vary: accept-language` ([ADR-0021](../docs/adr/0021-a-url-without-a-language-is-served-in-the-language-asked-for.md)): a cache that ignores `Vary` must not cache it. HTML asks to be revalidated; files under `/assets/` never change. Every file answers byte ranges (`Accept-Ranges: bytes`), which video playback on phones depends on: a cache in front passes `Range` through, or serves whole files itself. On an address (`/gh/...`) the response depends on the request: a `GET` that accepts `text/html` gets a page rendered with what the address serves, everything else is MCP. The page says `vary: accept`, and `accept-language` as well without the parameter, and asks to be revalidated; MCP responses say `no-store`. A cache that honors both may cache the path; one that ignores `Vary` must not.
- **Probes.** `GET /healthz` and `GET /readyz` are not written to the access log.

The access log is one JSON line per request: request id, method, path without its query string, status, duration until the response started, client address and user agent.

## Building a release

This repository does not publish images. Whatever deploys the product builds the image itself:

1. Pin a commit of this repository, preferably one whose `CI` run is green. `main` is kept releasable, so any green commit is a candidate.
2. Build `deploy/Dockerfile` from the repository root for the platforms you run (`docker buildx build --platform linux/arm64 -f deploy/Dockerfile .`). The build needs no secrets and no build arguments.
3. Tag the image with the commit it was built from, keep tags immutable in your registry, and deploy by digest.

The image carries what it is distributed under at `/app`: `LICENSE.md`, `THIRD-PARTY-NOTICES.md` and `TRADEMARKS.md`; the web build carries the licenses of its bundled packages at `/licenses/npm.txt`, linked from every page, and the notices of its fonts and icons next to it.

## Rollout contract

Whatever rolls the image out must do this, in this order:

1. Run the new image with the `migrate` command to completion. A non-zero exit aborts the rollout. It brings the database's schema and the job queue's up to this build.
2. Roll `api` and `worker` to the new image. Old and new versions overlap, which is why migrations are backward compatible (see [`packages/db/CLAUDE.md`](../packages/db/CLAUDE.md)).
3. Gate traffic on `GET /readyz`, restart on `GET /healthz` failures, and send `SIGTERM` with a grace period before killing.
4. Roll back by redeploying the previous digest. Because migrations only expand, the previous version keeps working.

`api` is stateless and scales horizontally behind any load balancer without session affinity; indexing in flight is handed back to the database on shutdown, so a replica may be stopped at any moment. So may a `worker`: its running jobs go back to the queue, and the next worker takes them.

## Repository settings checklist

Set once in GitHub; none of it can be expressed in files here.

- Branch protection on `main` is intentionally off for now: maintainers push directly. When the team moves to pull requests, require them together with the `CI` checks and a linear history.
- Enable secret scanning with push protection, Dependabot alerts and private vulnerability reporting.
- Actions: default `GITHUB_TOKEN` permission read-only; require approval before running workflows from first-time contributors. Allow GitHub Actions to create and approve pull requests (`Actions > General`): the release workflow opens its version pull request with that.
- On npm, each package under the `@skillcdn` scope has this repository registered as its trusted publisher, and then requires two-factor authentication with tokens disallowed. The publisher is GitHub Actions with organization `skillcdn`, repository `skillcdn`, workflow filename `release.yml` (the file name alone, not its path) and no environment name, and its allowed actions include `publish`. The four fields must match the run exactly: otherwise the registry answers the publish with `404 Not Found`. Without the `publish` action it answers `403 OIDC permission denied for this action`, since only staged publishes are allowed by default. Either way the Publish job fails within a second and nothing is published, so the run can be repeated once the publisher is right. A registration is pending until the workflow publishes through it once, and expires after two days unused: a package that saw no release in that time needs it registered again before its next one. The first version of a new package is published by a maintainer by hand, before the publisher can be registered.
- No cloud credentials, environments or deployment secrets belong to this repository. If a workflow here ever asks for one, that is a mistake.
