# @skillcdn/server

The single deployable. One build, one container image, several process roles ([ADR-0003](../../docs/adr/0003-one-image-several-roles.md)).

| Role | Command | Purpose |
|---|---|---|
| `api` | `node dist/main.js api` | MCP over HTTP, REST for the web UI, OAuth, webhook receiver. Stateless. |
| `worker` | `node dist/main.js worker` | Indexing, webhook processing, scheduled refresh. |
| `migrate` | `node dist/main.js migrate` | Apply pending database migrations, then exit. |

**Status:** role dispatch only. Roles are implemented in milestone 1 ([roadmap](../../docs/roadmap.md)).

## Running locally

```sh
docker compose -f deploy/compose.dev.yaml up -d    # PostgreSQL
cp .env.example .env                               # safe local defaults
pnpm dev                                           # compiler in watch mode + api restarting on change
```

## Intended layout

```
src/
  main.ts        role dispatch; nothing else
  roles.ts       the list of roles
  config/        the only place that reads process.env; validates once at boot
  roles/         api.ts, worker.ts, migrate.ts: build the dependency graph and start
  http/          Hono app: routes, middleware, error mapping
  mcp/           MCP endpoint and tool handlers (contracts come from @skillcdn/core)
  jobs/          job definitions and handlers (queue behind a port)
  indexer/       fetch tree, parse, write index
  adapters/      implementations of core ports that are not their own package yet (blob store, clock, ...)
```

Create directories when they get their first file. Do not add empty scaffolding.

## Process contract

- Exit codes: `64` for a usage error, `78` for invalid configuration, `70` for an internal failure or a role that is not implemented yet.
- `GET /healthz` is liveness. `GET /readyz` is readiness: database reachable and schema at the expected version.
- `SIGTERM`: stop accepting work, drain in-flight requests, release unfinished jobs, exit within the grace period.
- All configuration comes from the environment; see [`.env.example`](../../.env.example) and [`deploy/README.md`](../../deploy/README.md).
