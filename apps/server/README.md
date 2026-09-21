# @skillcdn/server

The single deployable. One build, one container image, several process roles ([ADR-0003](../../docs/adr/0003-one-image-several-roles.md)).

| Role | Command | Purpose | Status |
|---|---|---|---|
| `api` | `node dist/main.js api` | MCP over HTTP for public repositories. Stateless. Later: REST for the web UI, OAuth, webhooks. | implemented |
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

Then add `http://127.0.0.1:8080/gh/<owner>/<repo>` to an MCP client, or look at `src/api.int.test.ts` for a scripted session.

## Layout

```
src/
  main.ts        role dispatch and exit codes; nothing else
  roles.ts       the list of roles
  config/        the only place that reads process.env; validates once at boot
  roles/         api.ts (composition root, HTTP server, shutdown) and migrate.ts
  http/          Hono app: /healthz, /readyz, and the route that turns a URL into a mount
  mcp/           the per-request MCP server and the tool handlers (contracts come from @skillcdn/core)
  mounts/        address -> repository and commit, through the database first and the git host second
  indexer/       builds the index of a commit; coordinates who builds it (ADR-0007)
  adapters/      implementations of core ports that are not their own package (clock, ...)
  testing/       test support: a git host backed by the fixtures in skills/ (not compiled into dist)
```

Create directories when they get their first file. Do not add empty scaffolding.

## A request, end to end

1. `http/app.ts` parses the URL path with `parseAddress` and answers `400` for a malformed address.
2. `MountService` resolves the repository and the commit. Facts come from the database while they are fresh, from the git host otherwise, and from a slightly stale row when the host cannot be asked. Private, missing and forbidden repositories are one `404`.
3. Indexing of that commit starts in the background if nobody has done it ([ADR-0007](../../docs/adr/0007-snapshot-rows-coordinate-indexing.md)).
4. The MCP handler builds a server for this one request, bound to the mount ([ADR-0006](../../docs/adr/0006-mcp-sdk-v2-per-request-servers.md)). `find` and `get` wait for the index within a budget; `read_file` never waits.

## Process contract

- Exit codes: `64` for a usage error, `78` for invalid configuration, `70` for an internal failure or a role that is not implemented yet.
- `GET /healthz` is liveness. `GET /readyz` is readiness: database reachable, schema at least at the version this build ships, and not shutting down.
- `SIGTERM` or `SIGINT`: readiness fails, the listener stops accepting, requests in flight finish, unfinished indexing is handed back to the database, and the process exits within `SHUTDOWN_GRACE_SECONDS`.
- All configuration comes from the environment; see [`.env.example`](../../.env.example) and [`deploy/README.md`](../../deploy/README.md).

## Tests

- Unit tests next to the code.
- `src/api.int.test.ts` runs the real app against real PostgreSQL with the MCP client SDK and a git host backed by [`skills/`](../../skills/). It covers both protocol eras, sub-path mounts, hostile repositories, the indexing budget and the error surface. It needs the compose database, like the `db` integration tests.
