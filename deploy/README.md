# deploy/

Everything needed to build the image and hand it to whatever runs it. This repository stops at an image that builds: publishing images, registries, deployment pipelines, infrastructure, DNS, TLS, CDN and rollout live outside it ([ADR-0008](../docs/adr/0008-repository-ends-at-an-image-that-builds.md)).

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | The one multi-stage image. Roles `api`, `worker` and `migrate` are selected by the container command. |
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18). Not a production topology. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container), secret scan, and an image build that is then exercised: exit codes, `migrate`, readiness, non-root user, clean shutdown. It needs no secrets. |

A compose bundle and install script for self-hosting are planned ([roadmap](../docs/roadmap.md)).

## Build and run locally

```sh
docker build -f deploy/Dockerfile -t skillcdn .      # from the repository root
docker run --rm skillcdn migrate                     # one-off role
docker run --rm -p 11188:11188 --env-file .env skillcdn api
```

The image runs as a non-root user, contains production dependencies only, and has no secrets and no configuration baked in.

## Environment contract

The server is configured only through environment variables. [`.env.example`](../.env.example) is the source of truth; this table adds what operators need to know. Both are updated in the same change as the config module.

| Variable | Roles | Required | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV` | all | no | no | The image sets `production`. |
| `LOG_LEVEL` | all | no | no | Default `info`. |
| `HOST`, `PORT` | `api` | no | no | Defaults `0.0.0.0` and `11188`. |
| `SHUTDOWN_GRACE_SECONDS` | `api` | no | no | Default `20`. Keep the platform's stop timeout above it. |
| `HTTP_KEEP_ALIVE_SECONDS`, `HTTP_REQUEST_TIMEOUT_SECONDS` | `api` | no | no | Defaults `65` and `60`. See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| `ACCESS_LOG` | `api` | no | no | Default `true`: one log line per request, probes excluded. |
| `TRUSTED_PROXIES` | `api` | no | no | Addresses or CIDR networks whose forwarding headers are believed. Default: none. |
| `CLIENT_IP_HEADER`, `REQUEST_ID_HEADER` | `api` | no | no | Defaults `x-forwarded-for` and `x-request-id`. Read only from trusted proxies. |
| `DATABASE_URL` | all | yes | **yes** | PostgreSQL connection string. |
| `DATABASE_POOL_MAX` | `api` | no | no | Default `10` connections per process. |
| `GITHUB_API_URL` | `api`, `worker` | no | no | Default `https://api.github.com`. GitHub Enterprise Server: `https://<host>/api/v3`. |
| `GITHUB_TOKEN` | `api`, `worker` | no | **yes** | Optional, no scopes needed. Raises the GitHub rate limit for public-repo reads; without it the anonymous limit applies to the whole deployment. |
| `WEB_ROOT` | `api` | no | no | Directory of a web UI build. The image sets `/app/web`; set it to an empty value to run without a UI. The build's render module runs inside the server, so only ever point this at a build made from this repository. |
| `PUBLIC_URL` | `api` | no | no | The origin visitors use, such as `https://skills.example.com`. Goes into canonical links, the sitemap and the URLs pages show. Without it the origin of each request is used, which is wrong behind a proxy that terminates TLS. |
| `FEATURED_ADDRESSES` | `api` | no | no | Addresses shown on the front page of the explorer, comma-separated (`/gh/owner/repo`). At most 24. Default: none. |
| `GOOGLE_SITE_VERIFICATION` | `api` | no | no | The content of the `google-site-verification` meta tag a search console asks for; written into the head of every page. |
| `GOOGLE_ANALYTICS_ID` | `api` | no | no | A Google Analytics measurement id (`G-...`). Set, every page loads the analytics script, and the content security policy allows its sources and nothing else new. Whether visitors must consent first depends on where they are; the UI ships no consent banner. |
| `USAGE_STATS`, `USAGE_STATS_FLUSH_SECONDS` | `api` | no | no | Daily counts per public repository (connections, tool calls, skill loads, distinct clients), without anything that identifies a client: addresses are hashed under a key that is deleted with the day. Defaults `true` and `15`. |
| `REPO_TTL_SECONDS`, `REF_TTL_SECONDS` | `api` | no | no | How long repository facts and moving refs are trusted before revalidation. Default `60` each. |
| `INDEX_WAIT_MS` | `api` | no | no | How long a tool call waits for a new commit's index. Default `20000`. |
| `INDEX_CONCURRENCY`, `INDEX_LEASE_SECONDS` | `api`, `worker` | no | no | Commits indexed at once per process, and the lifetime of an indexing claim. |
| `INDEX_MAX_*`, `READ_MAX_FILE_BYTES` | `api`, `worker` | no | no | Limits on the work one repository may cause, including the unpacked size of a commit archive; see [`.env.example`](../.env.example). |

Invalid configuration stops the process with exit code `78` and a message that names the variable and the rule, never the value.

Every secret `NAME` may instead be provided as `NAME_FILE`, a path to a file holding the value, so secret mounts work. Secrets are injected at runtime by the platform (for example a task definition that references a secret store). They are never build arguments, image layers or committed files.

## Behind a reverse proxy

The `api` role speaks plain HTTP and expects TLS, caching and per-client rate limiting to happen in front of it. What the server needs to know about that front:

- **Who the proxies are.** List their addresses or networks in `TRUSTED_PROXIES`. Forwarding headers are believed only when the peer on the socket is on that list; from anyone else they are ignored, because anyone can send them. With `x-forwarded-for` the client is the nearest address in the chain that is not a trusted proxy. If your proxy passes the client address in a header of its own, name it in `CLIENT_IP_HEADER`; it is then read as a single address. Make sure the proxy overwrites that header instead of passing on what the client sent.
- **Request ids.** A trusted proxy's id (`REQUEST_ID_HEADER`) is adopted; otherwise the server makes one. Either way it is in every log line of the request and in the `x-request-id` response header, so a report from a user can be matched to the logs.
- **Idle connections.** Keep `HTTP_KEEP_ALIVE_SECONDS` above the idle timeout of the proxy. When the server closes an idle connection first, the proxy occasionally sends a request into it and answers its client with a gateway error.
- **Slow answers.** A tool call may wait up to `INDEX_WAIT_MS` for an index. The proxy's response timeout has to be longer than that.
- **Streaming.** MCP responses may be event streams. Do not buffer or transform `text/event-stream` responses.
- **Cross-origin calls.** The REST API under `/api/` answers browsers on any origin by itself: pass `OPTIONS` requests and `access-control-*` headers through. The MCP endpoint answers no other origin yet.
- **Pages.** With a web UI, set `PUBLIC_URL`. Every URL has exactly one representation (the language is the `lang` query parameter, never `Accept-Language`), so pages and files may be cached by URL, query string included. HTML asks to be revalidated; files under `/assets/` never change. On an address (`/gh/...`) the response depends on the request: a `GET` that accepts `text/html` gets a page rendered with what the address serves, everything else is MCP. The page says `vary: accept` and asks to be revalidated; MCP responses say `no-store`. A cache that honors both may cache the path; one that ignores `Vary` must not.
- **Probes.** `GET /healthz` and `GET /readyz` are not written to the access log.

The access log is one JSON line per request: request id, method, path without its query string, status, duration until the response started, client address and user agent.

## Building a release

This repository does not publish images. Whatever deploys the product builds the image itself:

1. Pin a commit of this repository, preferably one whose `CI` run is green. `main` is kept releasable, so any green commit is a candidate.
2. Build `deploy/Dockerfile` from the repository root for the platforms you run (`docker buildx build --platform linux/arm64 -f deploy/Dockerfile .`). The build needs no secrets and no build arguments.
3. Tag the image with the commit it was built from, keep tags immutable in your registry, and deploy by digest.

## Rollout contract

Whatever rolls the image out must do this, in this order:

1. Run the new image with the `migrate` command to completion. A non-zero exit aborts the rollout.
2. Roll `api` and `worker` to the new image. Old and new versions overlap, which is why migrations are backward compatible (see [`packages/db/CLAUDE.md`](../packages/db/CLAUDE.md)).
3. Gate traffic on `GET /readyz`, restart on `GET /healthz` failures, and send `SIGTERM` with a grace period before killing.
4. Roll back by redeploying the previous digest. Because migrations only expand, the previous version keeps working.

`worker` tolerates interruption at any time, so it can run on interruptible capacity. `api` is stateless and scales horizontally behind any load balancer without session affinity.

## Repository settings checklist

Set once in GitHub; none of it can be expressed in files here.

- Branch protection on `main` is intentionally off for now: maintainers push directly. When the team moves to pull requests, require them together with the `CI` checks and a linear history.
- Enable secret scanning with push protection, Dependabot alerts and private vulnerability reporting.
- Actions: default `GITHUB_TOKEN` permission read-only; require approval before running workflows from first-time contributors.
- No cloud credentials, environments or deployment secrets belong to this repository. If a workflow here ever asks for one, that is a mistake.
