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

interface Journal {
  readonly entries: readonly { readonly tag: string; readonly when: number }[];
}

function latestMigration(): { tag: string; when: number } | undefined {
  const journal: Journal = JSON.parse(
    readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"),
  );
  return journal.entries.at(-1);
}

/**
 * Applies pending migrations on a dedicated connection, under an advisory lock, without the
 * statement timeout that ordinary queries run with. Safe to run concurrently and repeatedly.
 */
export async function migrateDatabase(connectionString: string): Promise<{ latest: string }> {
  const client = new Client({
    connectionString,
    application_name: "skillcdn-migrate",
    lock_timeout: 10_000,
  });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
  } finally {
    // Closing the session releases the advisory lock, whatever happened above.
    await client.end();
  }
  return { latest: latestMigration()?.tag ?? "none" };
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
