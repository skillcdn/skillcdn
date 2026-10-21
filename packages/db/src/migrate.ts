import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { type Database, drizzleOf } from "./client.js";

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
 * that has the extension available and none of their tables: they were skipped when they first
 * ran, before the extension was there.
 */
async function applyVectorMigrationsAgain(client: Client): Promise<void> {
  const { rows } = await client.query<{ available: boolean; present: boolean }>(
    "select exists (select 1 from pg_available_extensions where name = 'vector') as available, to_regclass('section_vectors') is not null as present",
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
 * Applies pending migrations on a dedicated connection, under an advisory lock, without the
 * statement timeout that ordinary queries run with. Safe to run concurrently and repeatedly.
 * The notices the database raised on the way come back with the result: a migration that
 * leaves something out, such as the table of the search by meaning where the `vector`
 * extension is not available, says so in one.
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
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    await applyVectorMigrationsAgain(client);
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
