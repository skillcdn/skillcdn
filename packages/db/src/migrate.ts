import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { type Database, drizzleOf } from "./client.js";
import { installJobQueue } from "./jobs.js";

// Generated SQL ships next to the compiled code: <package>/migrations beside <package>/dist.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
/** Arbitrary constant: serializes migration runs that start at the same time. */
const MIGRATION_LOCK_KEY = 5_434_001;
/**
 * The first line of a migration that depends on the `vector` extension (ADR-0064). Such a
 * migration makes its tables where the extension is and nothing where it is not, and is written
 * to run twice, so that a database where the extension arrived after the migration ran gets the
 * tables on the next run.
 */
const NEEDS_VECTOR = "-- needs: vector";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
/**
 * The first line of a migration whose indexes are built `CONCURRENTLY` on a database in use
 * (ADR-0090). It holds `CREATE INDEX IF NOT EXISTS` statements and nothing else. The migrations
 * run in one transaction, where an index cannot be built that way, and an index built the plain
 * way keeps every write to its table waiting for as long as the build takes. So on a database
 * that was migrated before, each index of a marked migration still to be applied is built ahead
 * of that transaction, outside any, and the migration finds it there; on a new database the
 * migration builds it, over a table with nothing in it.
 */
const BUILT_CONCURRENTLY = "-- built: concurrently";
const CREATE_INDEX = /^CREATE (UNIQUE )?INDEX IF NOT EXISTS "([a-z0-9_]+)" ON /u;
/** A table or a column that is not there (SQLSTATE): it comes with a migration still to run. */
const NOT_THERE_YET = new Set(["42P01", "42703"]);
/**
 * The notices of what `IF NOT EXISTS` found there already (a schema, a table, an extension):
 * raised on every run, and not news. SQLSTATE codes.
 */
const QUIET_NOTICE_CODES = new Set(["42P06", "42P07", "42710"]);

interface Journal {
  readonly entries: readonly { readonly tag: string; readonly when: number }[];
}

function readJournal(): Journal {
  return JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"));
}

function latestMigration(): { tag: string; when: number } | undefined {
  return readJournal().entries.at(-1);
}

/**
 * Applies again, in order, the migrations that depend on the `vector` extension, on a database
 * that has the extension available and not every table of theirs: they were skipped when they
 * first ran, before the extension was there, or, for the tables of the part vectors and of the
 * sections at half precision, while the extension was older than its half-precision type
 * (ADR-0092, ADR-0103).
 */
async function applyVectorMigrationsAgain(client: Client): Promise<void> {
  const { rows } = await client.query<{ available: boolean; present: boolean }>(
    "select exists (select 1 from pg_available_extensions where name = 'vector') as available, to_regclass('section_vectors') is not null and (to_regtype('halfvec') is null or (to_regclass('part_vectors') is not null and to_regclass('section_halves') is not null)) as present",
  );
  const state = rows[0];
  if (state === undefined || !state.available || state.present) {
    return;
  }
  for (const entry of readJournal().entries) {
    const text = readFileSync(`${MIGRATIONS_FOLDER}/${entry.tag}.sql`, "utf8");
    if (!text.startsWith(NEEDS_VECTOR)) {
      continue;
    }
    for (const statement of text.split(STATEMENT_BREAKPOINT)) {
      await client.query(statement);
    }
  }
}

/**
 * Builds, `CONCURRENTLY`, the indexes of the migrations marked {@link BUILT_CONCURRENTLY} that
 * this database has not applied yet. Nothing on a database that was never migrated. An index a
 * build left unfinished is there by its name and used by nothing, so it is dropped and built
 * again; one whose table or column comes with a migration still to run is left to its migration.
 */
async function buildIndexesAhead(client: Client): Promise<void> {
  const migrated = await client.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );
  if (migrated.rows[0]?.present !== true) {
    return;
  }
  const last = await client.query<{ applied: string | null }>(
    `select max(created_at) as applied from ${client.escapeIdentifier(MIGRATIONS_SCHEMA)}.${client.escapeIdentifier(MIGRATIONS_TABLE)}`,
  );
  const applied = Number(last.rows[0]?.applied ?? 0);
  if (applied === 0) {
    return;
  }
  for (const entry of readJournal().entries) {
    if (entry.when <= applied) {
      continue;
    }
    const text = readFileSync(`${MIGRATIONS_FOLDER}/${entry.tag}.sql`, "utf8");
    if (!text.startsWith(BUILT_CONCURRENTLY)) {
      continue;
    }
    for (const part of text.slice(BUILT_CONCURRENTLY.length).split(STATEMENT_BREAKPOINT)) {
      const statement = part.trim();
      if (statement === "") {
        continue;
      }
      const name = CREATE_INDEX.exec(statement)?.[2];
      if (name === undefined) {
        throw new Error(
          `migration ${entry.tag} is built concurrently and holds a statement that is not CREATE INDEX IF NOT EXISTS`,
        );
      }
      const found = await client.query<{ valid: boolean }>(
        "select indisvalid as valid from pg_index where indexrelid = to_regclass($1)",
        [name],
      );
      if (found.rows[0]?.valid === false) {
        await client.query(`drop index concurrently if exists ${client.escapeIdentifier(name)}`);
      }
      try {
        await client.query(
          statement.replace(CREATE_INDEX, 'CREATE $1INDEX CONCURRENTLY IF NOT EXISTS "$2" ON '),
        );
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code !== "string" || !NOT_THERE_YET.has(code)) {
          throw error;
        }
      }
    }
  }
}

/**
 * Applies pending migrations on a dedicated connection, under an advisory lock, without the
 * statement timeout that ordinary queries run with, and then installs the schema of the job
 * queue, or brings it to the version this build ships (ADR-0064). Indexes of tables that are
 * large on a database in use are built before the migrations, without holding writes off
 * ({@link BUILT_CONCURRENTLY}). Safe to run concurrently and repeatedly. The notices the database
 * raised on the way come back with the result: a migration that leaves something out, such as
 * the table of the search by meaning where the `vector` extension is not available, says so in
 * one.
 */
export async function migrateDatabase(
  connectionString: string,
): Promise<{ latest: string; notices: readonly string[] }> {
  const client = new Client({
    connectionString,
    application_name: "skillcdn-migrate",
    lock_timeout: 10_000,
  });
  const notices: string[] = [];
  client.on("notice", (notice) => {
    if (notice.message !== undefined && !QUIET_NOTICE_CODES.has(notice.code ?? "")) {
      notices.push(notice.message);
    }
  });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    // A concurrent build waits for the transactions that were open when it began and keeps
    // nobody waiting meanwhile, so it is given the time the lock timeout would cut short.
    await client.query("set lock_timeout = 0");
    await buildIndexesAhead(client);
    await client.query("reset lock_timeout");
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    await applyVectorMigrationsAgain(client);
    // The queue keeps its schema with its own versions, under its own lock, on a connection of
    // its own; it runs inside ours so that two migrate runs cannot interleave.
    await installJobQueue(connectionString);
  } finally {
    // Closing the session releases the advisory lock, whatever happened above.
    await client.end();
  }
  return { latest: latestMigration()?.tag ?? "none", notices };
}

export interface SchemaStatus {
  /** True when every migration this build ships has been applied. A newer schema is fine. */
  readonly current: boolean;
  readonly expected: string;
}

/** Compares what the database has applied with what this build ships. Used for readiness. */
export async function getSchemaStatus(database: Database): Promise<SchemaStatus> {
  const latest = latestMigration();
  if (latest === undefined) {
    return { current: true, expected: "none" };
  }
  try {
    const result = await drizzleOf(database).execute<{ applied: string | null }>(
      sql`select max(created_at) as applied from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
    );
    const applied = Number(result.rows[0]?.applied ?? 0);
    return { current: applied >= latest.when, expected: latest.tag };
  } catch {
    // Unreachable database, or migrations never ran: either way the schema is not current.
    return { current: false, expected: latest.tag };
  }
}
