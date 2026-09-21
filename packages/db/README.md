# @skillcdn/db

PostgreSQL schema, migrations and the query layer. PostgreSQL is the only stateful dependency of the product ([ADR-0004](../../docs/adr/0004-postgresql-only-state.md)).

**Status:** empty entry point. The first schema arrives in milestone 1 ([roadmap](../../docs/roadmap.md)).

## Planned layout

```
src/
  schema/        Drizzle table definitions
  queries/       typed query functions, the only public way to reach the data
  client.ts      pool and client construction from a connection string passed in by the caller
  migrate.ts     applies migrations; used by the server's migrate role
migrations/      generated SQL, committed, shipped inside the package
```

## Local database

```sh
docker compose -f deploy/compose.dev.yaml up -d
```

PostgreSQL 18 on `127.0.0.1:5432`. The connection string is in [`.env.example`](../../.env.example).

## Data model

_Not defined yet. Document tables, keys and indexes here in the same change that adds them. The conceptual entities are listed in [architecture.md](../../docs/architecture.md#data-and-storage)._
