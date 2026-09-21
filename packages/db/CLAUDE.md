# packages/db: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. Mistakes here are the hardest to undo, so this package is deliberately strict.

## Migrations

- Change the schema in `src/schema.ts`, generate the migration with `pnpm --filter @skillcdn/db run generate --name <what-changed>`, review the SQL, and commit both. Never write to a database by hand.
- **Never edit a migration that has been pushed to `main`.** Fix forward with a new one.
- **Expand, then contract.** Old and new versions of the server run side by side during a rollout, so every migration must work with the previous release's code. Add first; remove or rename in a later release, after no deployed code uses the old shape.
- Be kind to a live database: build indexes `CONCURRENTLY`, avoid rewriting large tables, set a `lock_timeout`, and backfill in batches from a job, not inside a migration.
- When you and `main` have both added migrations, rebase and regenerate yours.

## Schema

- Primary keys are `uuid` with `DEFAULT uuidv7()`. The one exception is a content-addressed table, which is keyed by its hash. Timestamps are `timestamptz`. Every table has `created_at`.
- Every tenant-scoped table carries `account_id`, and every query on it takes the account as a required argument. A table that is deliberately not tenant-scoped (a lookup read before the account is known, a content-addressed store) says so in `README.md`, with the rule that keeps it safe.
- Index entries for a `(repo, commit)` are immutable: insert and delete, never update.
- Secrets at rest: git-host user tokens are encrypted by the caller before they reach this package; project tokens are stored as hashes only.
- The job queue's schema belongs to the queue library. Never touch its tables.

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
