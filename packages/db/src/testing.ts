import { randomBytes } from "node:crypto";
import { HEAD_SECTION } from "@skillcdn/core";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { createDatabase, type Database, drizzleOf, poolOf } from "./client.js";
import { migrateDatabase } from "./migrate.js";
import { HEAD_PART } from "./queries/vectors.js";
import { partVectors, sectionVectors, snapshots } from "./schema.js";

// Support for integration tests, here and in other workspaces: `@skillcdn/db/testing`.

export {
  type HubQuestion,
  type HubStatementReading,
  readHubStatements,
} from "./queries/hub.js";

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

/**
 * For a test of a statement that runs out of its time: keeps every statement that reads the
 * entries waiting, until the function it answers with is called. The test lets go within the
 * time a transaction may stay idle.
 */
export async function holdIndexEntries(database: Database): Promise<() => Promise<void>> {
  const client = await poolOf(database).connect();
  try {
    await client.query("begin");
    await client.query("lock table index_entries in access exclusive mode");
  } catch (error) {
    client.release(true);
    throw error;
  }
  return async () => {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  };
}

/**
 * For a test of the sweep that makes them (ADR-0092): leaves the database as one is on the day
 * it is given the table of the part vectors, with the vectors of the sections and none of the
 * parts. Says how many rows went.
 */
export async function dropPartVectors(database: Database): Promise<number> {
  const removed = await drizzleOf(database)
    .delete(partVectors)
    .returning({ part: partVectors.part });
  return removed.length;
}

/**
 * For a test of the sweep that gives them (ADR-0094): leaves the database as one is on the day
 * a skill is given a head, with the vectors of the sections of its skills and no head. Says how
 * many heads went; the parts they were go with them.
 */
export async function dropHeadVectors(database: Database): Promise<number> {
  const db = drizzleOf(database);
  const removed = await db
    .delete(sectionVectors)
    .where(eq(sectionVectors.section, HEAD_SECTION))
    .returning({ blobSha: sectionVectors.blobSha });
  await db.delete(partVectors).where(eq(partVectors.part, HEAD_PART));
  return removed.length;
}

/**
 * For a test of a rebuild (ADR-0068): marks the index of a commit as written under `version` of
 * the reading rules, which is how a deployment finds its indexes after the rules have changed.
 */
export async function markIndexVersion(
  database: Database,
  commitSha: string,
  version: number,
): Promise<void> {
  await drizzleOf(database)
    .update(snapshots)
    .set({ indexVersion: version })
    .where(eq(snapshots.commitSha, commitSha));
}
