# ADR-0004: PostgreSQL as the only stateful dependency

- Status: Accepted
- Date: 2026-09-21

## Context

SkillCDN needs a content index with search, a permission cache, a job queue, and later vector search. Each could be its own service. Every extra service is another thing self-hosted installs must run, another thing that differs between hosted and self-hosted, and another bill.

## Decision

- PostgreSQL 18 is the only stateful service the product requires. It provides full-text search (`tsvector` with GIN indexes), the permission cache, the job queue (pg-boss) and, later, vectors (pgvector).
- Data access uses Drizzle ORM on the `pg` driver. Migrations are generated SQL files, reviewed and committed, applied by the `migrate` role.
- Large file bodies go to S3-compatible object storage under their content hash. Object storage is a cache: it can be rebuilt from the git host.
- Queue and storage access sit behind ports, so either can be replaced without touching callers.

## Consequences

- A complete install is one image, one PostgreSQL and a bucket or a disk.
- Search quality, queue throughput and cache load all land on one database. We accept that until measurements say otherwise; the ports are the exit.
- Schema changes must stay backward compatible across one release (expand, then contract), because old and new versions overlap during a rollout.
- Integration tests run against real PostgreSQL. Substituting another engine in tests would hide exactly the behavior we depend on.
- Rejected: a dedicated search engine, a separate queue broker and a separate cache (operational weight and drift between hosted and self-hosted, for capacity we do not need yet).
