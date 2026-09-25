# @skillcdn/db

PostgreSQL schema, migrations and the query layer. PostgreSQL is the only stateful dependency of the product ([ADR-0004](../../docs/adr/0004-postgresql-only-state.md)).

**Status:** the schema for serving public repositories: repositories, ref cache, per-commit index with full-text search, a content-addressed body store, and daily usage counters.

## Layout

```
src/
  schema.ts      Drizzle table definitions (one file: drizzle-kit reads it directly)
  client.ts      pool construction from a connection string passed in by the caller
  migrate.ts     applies migrations; reports whether the schema is current
  queries/       typed query functions, the only public way to reach the data
  testing.ts     per-file throwaway databases for integration tests (`@skillcdn/db/testing`)
migrations/      generated SQL, committed, shipped inside the package
```

Other workspaces hold an opaque `Database` and call the exported functions. They never see the ORM or SQL.

## Working on the schema

```sh
docker compose -f deploy/compose.dev.yaml up -d      # PostgreSQL 18 on 127.0.0.1:5432
# edit src/schema.ts, then:
pnpm --filter @skillcdn/db run generate --name <what-changed>
# review the SQL in migrations/, run the tests, commit schema and migration together
```

Integration tests (`*.int.test.ts`) create a database per test file, apply the real migrations and drop it afterwards. They connect to the compose database unless `TEST_DATABASE_URL` points elsewhere, and they fail, not skip, when no server answers.

## Data model

Index entry front-matter also stores resolved local Markdown references (`href` and repository-root `path`), `linkedOnly` for files made readable by links without entering the document catalog or search, and `manifestError` for repository manifests whose presence defines a closed boundary despite an unreadable body. These are optional JSON fields; they do not add database columns.

Primary keys are `uuid DEFAULT uuidv7()` and timestamps are `timestamptz`, with one exception noted below. Tenant-scoped tables carry `account_id`, and every query on them takes the account.

| Table | What a row is | Keys and indexes |
|---|---|---|
| `accounts` | An organization or user on a git host: the tenant unit. | unique `(host, host_account_id)` |
| `repos` | A repository, identified by the host's immutable id, so renames and transfers keep their index. Holds what the host last reported: name, default branch, description, visibility. | unique `(host, host_repo_id)`; `account_id` |
| `repo_aliases` | An `owner/name` spelling from an address (lowercase) and the repository it currently names, with `checked_at` for the freshness of that fact. A lookup index read before the account is known, so it is not tenant-scoped. | unique `(host, owner, name)`; `repo_id` |
| `repo_refs` | Cache of a moving ref: `ref` (empty for the default branch) to `commit_sha`, with `checked_at`. | unique `(repo_id, ref)` |
| `snapshots` | The index of one commit of one repository and how far building it has come: `status` (`pending`, `indexing`, `ready`, `failed`), `attempts`, `lease_expires_at` and `lease_owner` (the claim that holds it while indexing), `retry_at`, `error_code`, `truncated`, counters, `diagnostics` for the repository author, `license` (the license that governs the repository outside its skills, as the index resolved it from its license file or its root manifest; ADR-0026), and `index_version`, the reading rules the index was written with: a ready index below the rules in force goes back to `pending` when it is next asked for, so a change to what is indexed reaches every commit. | unique `(repo_id, commit_sha)`; `account_id` |
| `index_entries` | One file of a snapshot: `path`, `kind` (`skill`, `manifest`, `markdown`, `json`, `other`), `size`, `blob_sha`, the owning `skill_dir`, skill or repository `name`, document `title`, `description`, `front_matter` (a skill's, with the files it `include`s and its `translations`; or a repository manifest's, with the `documents` it declares, its `language` and its `translations`), the `search` vector (null when the file is listed but not searchable), `visible` (false for a file outside the skills and the document directories: known to the index, served by nothing), `digest` and `served_size` (SHA-256 in hex and size of what the file is served as, when its bytes are stored; for a listed skill's `SKILL.md`, of the assembled document), and `listed` (true for a skill the MCP skills extension lists; the reason it is not is `unlisted` in `front_matter`), and `license_kind` (for a skill: what the license the index resolved for it allows, `permissive`, `restrictive` or `none`; the fact itself, with the license name and where it was found, is `licenseFact` in `front_matter`; ADR-0026). **Immutable: inserted and deleted, never updated.** | unique `(snapshot_id, path)`; `(snapshot_id, kind)`; `(snapshot_id, skill_dir)`; GIN on `search`; `account_id` |
| `usage_daily` | How often something happened to a repository on one UTC day: `metric` (`connection`, `tool_call`, `skill_load`, `client`), `subject` (the tool name, the skill directory, or empty) and `count`. Counters are only ever added to. Nothing in a row identifies a client. `client` is the number of distinct clients, written when the day is folded. | unique `(repo_id, day, metric, subject)`; `(day, metric)`; `account_id` |
| `usage_clients` | The distinct clients seen at a repository on the day being counted: `client` is an HMAC of the client's address under that day's key. Rows exist until the day is folded into `usage_daily`, then they are deleted ([ADR-0010](../../docs/adr/0010-distinct-clients-by-daily-keyed-hash.md)). | unique `(repo_id, day, client)`; `day`; `account_id` |
| `usage_client_keys` | One random key per UTC day, made by the first process that asks and deleted when the day is folded. Not tenant-scoped: it keys hashes across every repository, and it is read by nothing but the counting itself. | unique `day` |
| `blobs` | A file body keyed by its git blob hash: `bytes` as the repository has them, and `size`. Content-addressed, so the hash is the primary key and one row serves every commit, ref and fork. Text is derived from the bytes on read. `content` holds the text of rows written before bytes were stored; such a row is read as it is, counts as missing so that the next index fetches its bytes, and is dropped in a later release. Not tenant-scoped: a body is only ever read through an index entry the caller may see, never by a hash from user input. | primary key `sha` |
| `operator_repositories` | An entry of one of the operator's lists ([ADR-0026](../../docs/adr/0026-serving-follows-the-license-and-the-operators-lists.md)): `kind` (`verified`, `featured`, `blocked`) and the `address` it names, written as the address grammar prints it (`/gh/owner/repo`, with a ref and a path only when `featured`). Not tenant-scoped: it is the operator's, read for every request. | unique `(kind, address)` |

How it behaves:

- **Claiming a snapshot** is one atomic `UPDATE`: it succeeds for a `pending` row, for an `indexing` row whose lease expired, and for a `failed` row whose `retry_at` has passed. Exactly one process wins, and its claim carries an owner token. Renewing, writing, failing and releasing succeed only for the holder, so a process whose lease ran out while it was paused cannot undo what its successor did. The winner renews its lease while it works and releases the row on shutdown.
- **Writing an index** replaces the entries and marks the snapshot `ready` in one transaction, so readers see no index or a complete one. It refuses when the caller no longer holds the snapshot.
- **Publication metadata** in `front_matter` records manifest `exclude` paths and `overviewOnly` README introductions. Exclusions and unreadable policies close their scopes before indexing descendants. Overview-only entries remain readable without search vectors or document counts; manifest lookup also requires a visible entry.
- **Search vector**: weight A for the original skill name and document title, B for the original description, C for the words of the path, D for the first 200,000 characters of the parsed body (for a file searched without a parsed body, its bytes decoded as UTF-8, which they are by construction). Markdown front-matter is excluded from body search, so display translations do not become search aliases. The configuration is `english` for both indexing and querying; original words in other languages are indexed as they are.
- **Search** matches any word of the query and orders by rank, with skills boosted over plain documents. A query without usable words returns nothing. The mount path is matched with `starts_with`, so `%` and `_` in a path are ordinary characters. Result order uses the `C` collation and is the same on every database.
- **Usage counters** are written with an upsert that adds, so every process reports what it counted without knowing about the others. **Distinct clients** are rows of `usage_clients` inserted with "do nothing" on conflict; `foldUsageClients` moves every day before the given one into `client` counts and deletes the rows and their keys in the same statement, so processes that fold at once each move their own share and the totals still add up. `getRepoUsage` is scoped to an account like everything else. `listTopRepositories` deliberately is not: it is what a public ranking is made of, and the rule that keeps it safe is in the query itself, which reads only repositories that are public right now. A repository that goes private drops out of it with all its history.
- A transferred repository moves to its new account; snapshots written under the old account are no longer visible and the repository is indexed again.

Not here yet: installations, tokens, the permission cache (private repositories) and the job queue's own schema.
