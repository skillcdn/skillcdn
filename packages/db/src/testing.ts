import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { createDatabase, type Database } from "./client.js";
import { migrateDatabase } from "./migrate.js";

// Support for integration tests, here and in other workspaces: `@skillcdn/db/testing`.

/** Where `deploy/compose.dev.yaml` listens. Tests use it unless TEST_DATABASE_URL says otherwise. */
export const DEV_DATABASE_URL = "postgres://skillcdn:skillcdn-dev-only@127.0.0.1:5432/skillcdn";

export interface TestDatabase {
  readonly database: Database;
  readonly connectionString: string;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

/**
 * Creates a database of its own for one test file and migrates it with the real migrations, so
 * files run in parallel without seeing each other. `adminUrl` needs the right to create databases.
 */
export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `skillcdn_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      "integration tests need PostgreSQL: run `docker compose -f deploy/compose.dev.yaml up -d`, or point TEST_DATABASE_URL at a server",
      { cause: error },
    );
  }
  try {
    // Identifiers cannot be bound as parameters; escaping is the supported way to pass one.
    await admin.query(`create database ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const connectionString = url.href;
  await migrateDatabase(connectionString);
  const database = createDatabase({ connectionString, maxConnections: 4 });

  return {
    database,
    connectionString,
    drop: async () => {
      await database.close();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(
          `drop database if exists ${cleanup.escapeIdentifier(name)} with (force)`,
        );
      } finally {
        await cleanup.end();
      }
    },
  };
}
