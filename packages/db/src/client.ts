import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Drizzle = NodePgDatabase<typeof schema>;

export interface DatabaseOptions {
  /** Passed in by the caller. This package never reads the environment. */
  readonly connectionString: string;
  readonly maxConnections?: number;
  /** Shows up in `pg_stat_activity`. */
  readonly applicationName?: string;
  readonly statementTimeoutMs?: number;
}

/**
 * An open connection pool. Deliberately opaque: other workspaces hold it and pass it to the
 * functions this package exports; they never see the ORM or SQL.
 */
export interface Database {
  /** True when a query reaches the server. Never throws. */
  ping(): Promise<boolean>;
  /** Waits for checked-out connections to come back, then closes the pool. */
  close(): Promise<void>;
}

const handles = new WeakMap<Database, Drizzle>();

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? "skillcdn",
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // An idle client that loses its connection emits "error"; without a listener that is fatal.
  // The pool replaces the client on its own, so there is nothing to do here.
  pool.on("error", () => {});

  const database: Database = Object.freeze({
    ping: async () => {
      try {
        await pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  });
  handles.set(database, drizzle({ client: pool, schema, casing: "snake_case" }));
  return database;
}

/** For this package only: the ORM behind a {@link Database}. Not exported from the entry point. */
export function drizzleOf(database: Database): Drizzle {
  const handle = handles.get(database);
  if (handle === undefined) {
    throw new TypeError("not a Database created by createDatabase");
  }
  return handle;
}
