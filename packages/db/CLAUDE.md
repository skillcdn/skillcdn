# packages/db: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. Mistakes here are the hardest to undo, so this package is deliberately strict.

## Migrations

- Change the schema in `src/schema.ts`, generate the migration with `pnpm --filter @skillcdn/db run generate --name <what-changed>`, review the SQL, and commit both. Never write to a database by hand.
- **Never edit a migration that has been pushed to `main`.** Fix forward with a new one.
- **Expand, then contract.** Old and new versions of the server run side by side during a rollout, so every migration must work with the previous release's code. Add first; remove or rename in a later release, after no deployed code uses the old shape.
- Be kind to a live database: build indexes `CONCURRENTLY`, avoid rewriting large tables, set a `lock_timeout`, and backfill in batches from a job, not inside a migration.
- When you and `main` have both added migrations, rebase and regenerate yours.
- The job queue (pg-boss) keeps its tables in the schema `pgboss`, which `migrateDatabase` installs and brings to the library's version after the migrations here (`installJobQueue`): never create or alter them by hand, and never reference them from a migration of this package. Queues themselves are rows the roles make sure of at start (`ensureQueue`), not migrations.
- The table of the search by meaning exists only where the `vector` extension does: `0020_section-vectors.sql` creates the extension and `section_vectors` inside one `DO` block, or neither, with a notice. Its first line, `-- needs: vector`, marks it as one `migrateDatabase` applies again, in order with the others so marked, on a database where the extension arrived after the migrations ran, so every statement in it is written to run twice (`IF NOT EXISTS`). The generator writes plain statements, so a later migration that touches that table is wrapped by hand in the same guard (`IF to_regclass('section_vectors') IS NOT NULL`), starts with the same line and is reviewed as such before it is committed.

## Schema

- Primary keys are `uuid` with `DEFAULT uuidv7()`. The one exception is a content-addressed table, which is keyed by its hash. Timestamps are `timestamptz`. Every table has `created_at`.
- Every tenant-scoped table carries `account_id`, and every query on it takes the account as a required argument. A table that is deliberately not tenant-scoped (a lookup read before the account is known, a content-addressed store) says so in `README.md`, with the rule that keeps it safe.
- Index entries for a `(repo, commit)` are immutable: insert and delete, never update.
- Secrets at rest: this package never sees a token. Git-host user tokens are encrypted by the caller before they reach it; sessions, authorization codes, access and refresh tokens, client secrets and repository tokens arrive as hashes. A column that would hold a usable credential is a mistake.

## Queries

- Other workspaces call the functions exported from this package. They do not import the ORM and do not build SQL.
- No string-built SQL, ever. Use the query builder or parameterized `sql` templates.
- Transactions are explicit: functions that must compose accept a transaction handle.
- This package never reads the environment. The caller passes the connection string in.

## Tests

- Integration tests (`*.int.test.ts`) run against real PostgreSQL from `deploy/compose.dev.yaml`. Never mock the database and never substitute another engine.
- Tests isolate themselves: `createTestDatabase` from `src/testing.ts` gives each test file its own migrated database. They fail when no server answers; they never skip.
- Pass time in (`now: Date`) instead of calling `now()` in SQL, so lease and retry logic is testable.
- Update the "Data model" section of `README.md` in the same change as the schema.

## Gotchas

- pg-boss keeps a singleton key out of the queue only under the `short` and `stately` policies; a `standard` queue takes a second job with the same key, and `send` answers an id for it. Every queue here is `stately`, so one job per key is queued and one runs at a time, and `send` answers `undefined` for the one it kept out. `createQueue` on a queue that exists changes nothing, which is why `ensureQueue` updates the settings after it; and `counts` are served from a reading the queue took within the last minute, even when asked for fresh (`total` from its last maintenance pass), so a test of what just ran reads the job's state live first (`failures`) and then gives the counts that minute; the count a test asked for while a job ran says so until the minute is over. A job that waits keeps a later job of the same key out, its priority with it: a changed priority reaches a waiting job only through `reorder`, pg-boss's `update`, which edits a job that waits (`created` or `retry`) in place and never one that runs; that is how a sweep puts the embedding queue in the order of its build (ADR-0073). `findJobs` with `queued` lists the waiting ones, which `waiting` reads.
- The compose image moved from `postgres:18` to the one with the `vector` extension, which is built on an older Debian. On a data volume from before, PostgreSQL finds the C library's collation version changed and refuses to create a database from `template1` ("collation version mismatch"), so every integration test fails at once. Either start clean (`docker compose -f deploy/compose.dev.yaml down -v`, then `up -d`) or keep the data: `alter database template1 refresh collation version`, the same for `postgres` and `skillcdn`, then `reindex database skillcdn`, all through `docker exec skillcdn-dev-postgres-1 psql -U skillcdn -d postgres`.
