# @skillcdn/server

The single deployable. One build, one container image, several process roles ([ADR-0003](../../docs/adr/0003-one-image-several-roles.md)).

| Role | Command | Purpose | Status |
|---|---|---|---|
| `api` | `node dist/main.js api` | MCP over HTTP and the [REST API](../../docs/specs/rest.md) for public repositories. Stateless. Later: OAuth, webhooks. | implemented |
| `migrate` | `node dist/main.js migrate` | Apply pending database migrations, then exit. | implemented |
| `worker` | `node dist/main.js worker` | Webhook-driven and scheduled re-indexing. | not yet; `api` indexes lazily until then |

## Running locally

```sh
docker compose -f deploy/compose.dev.yaml up -d    # PostgreSQL
cp .env.example .env                               # safe local defaults; add a GITHUB_TOKEN to raise the rate limit
pnpm build
pnpm --filter @skillcdn/server run start migrate
pnpm dev                                           # compiler in watch mode + api restarting on change
```

Then add `http://127.0.0.1:11188/gh/<owner>/<repo>` to an MCP client, or look at `src/api.int.test.ts` for a scripted session.

To see the web UI on top of this server, run `pnpm dev:web:api` next to it ([`apps/web`](../web/README.md)). Working on the UI alone needs none of this: `pnpm dev:web` runs it against fixtures.

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
  roles/         api.ts (composition root, HTTP server, shutdown) and migrate.ts
  http/          Hono app: /healthz, /readyz, the route that turns a URL into a mount, the REST API,
                 what every request gets (id, client address, access log), and web.ts, which serves
                 a build of the web UI from its manifest (pages per language, files, sitemap, robots),
                 and the page of an address through the build's render module
  mcp/           the per-request MCP server and the tool handlers (contracts come from @skillcdn/core)
  mounts/        address -> repository and commit, through the database first and the git host second;
                 MountReader answers questions about a mount as data, for MCP and REST alike
  indexer/       builds the index of a commit; coordinates who builds it (ADR-0007)
  stats/         daily usage counters and distinct clients per public repository: added up in memory, written in batches
  adapters/      implementations of core ports that are not their own package (clock, ...)
  testing/       test support: a git host backed by the fixtures in skills/ (not compiled into dist)
```

Create directories when they get their first file. Do not add empty scaffolding.

## A request, end to end

1. `http/app.ts` parses the URL path with `parseAddress` and answers `400` for a malformed address.
2. `MountService` resolves the repository and the commit. Facts come from the database while they are fresh, from the git host otherwise, and from a slightly stale row when the host cannot be asked. Private, missing and forbidden repositories are one `404`.
3. Indexing of that commit starts in the background if nobody has done it ([ADR-0007](../../docs/adr/0007-snapshot-rows-coordinate-indexing.md)). The indexer lists the tree, asks the blob store which bodies it lacks, and fetches those: through one archive download when there are several, per file otherwise. A body from the archive counts only when it hashes to what the tree says.
4. `MountReader` answers from the index: what is there, one skill, one file. The MCP tools render its answers as text for a model; the REST API returns the same answers as JSON and never waits for the index.
5. The MCP handler builds a server for this one request, bound to the mount ([ADR-0006](../../docs/adr/0006-mcp-sdk-v2-per-request-servers.md)). `find` and `get` wait for the index within a budget; `read_file` never waits.

## Process contract

- Exit codes: `64` for a usage error, `78` for invalid configuration, `70` for an internal failure or a role that is not implemented yet.
- `GET /healthz` is liveness. `GET /readyz` is readiness: database reachable, schema at least at the version this build ships, and not shutting down.
- `SIGTERM` or `SIGINT`: readiness fails, the listener stops accepting, requests in flight finish, unfinished indexing is handed back to the database, and the process exits within `SHUTDOWN_GRACE_SECONDS`.
- All configuration comes from the environment; see [`.env.example`](../../.env.example) and [`deploy/README.md`](../../deploy/README.md).

## Tests

- Unit tests next to the code.
- `src/api.int.test.ts` runs the real app against real PostgreSQL with the MCP client SDK and a git host backed by [`skills/`](../../skills/). It covers both protocol eras, sub-path mounts, hostile repositories, the indexing budget and the error surface. It needs the compose database, like the `db` integration tests.
- `src/rest.int.test.ts` does the same for the REST API and parses every response with the schemas in `@skillcdn/core`, which are what the web UI parses with.
- `src/web.int.test.ts` and `src/http/web.test.ts` cover serving a web build: language variants, the public origin, caching, the content security policy, the sitemap with its featured and popular repositories, and an address answering a browser with a rendered page and everyone else with MCP. They use a small fake build with a fake render module (`src/testing/web-build.ts`), not `apps/web`.
- `src/testing/harness.ts` wires the app for all of them. Every test file has a database of its own; tests inside a file share it.
