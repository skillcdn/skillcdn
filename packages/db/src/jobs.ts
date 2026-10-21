import { PgBoss } from "pg-boss";
import { type Database, poolOf } from "./client.js";

// The job queue (ADR-0004, ADR-0064): jobs kept in PostgreSQL by pg-boss, in a schema of its own
// that the `migrate` role installs and the `api` and `worker` roles use without migrating. This
// module is the one place that knows the library; the roles see queues, jobs and counts.

/** The schema the queue lives in. The migrate role creates it; nothing else writes its tables. */
export const JOB_QUEUE_SCHEMA = "pgboss";

/** How a queue treats its jobs. Set when the queue is made sure of, the same on every process. */
export interface QueueSettings {
  /** How many times a failed job is tried again, with a backoff that doubles from `retryDelaySeconds`. */
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  /** How long one attempt may run before it counts as failed and the job is tried again. */
  readonly expireInSeconds: number;
}

export interface SendOptions {
  /** Higher runs first; among equals, the older first. */
  readonly priority?: number;
  /**
   * A key of which at most one job is queued and one is running at a time: a job sent while
   * one with the same key is queued is not queued, and `send` says so with `undefined`.
   */
  readonly singletonKey?: string;
}

export interface WorkOptions {
  /** How many jobs this process runs at once from the queue. Default 1. */
  readonly concurrency?: number;
  /** How often the queue is looked at for new jobs, in seconds; at least 0.5. Default 2. */
  readonly pollSeconds?: number;
}

/** A job as a handler receives it. The data is what was sent, and the handler validates it. */
export interface QueuedJob {
  readonly id: string;
  readonly data: unknown;
  /** 0 for the first attempt. */
  readonly attempt: number;
  /** Aborted when the queue stops while the job runs. */
  readonly signal: AbortSignal;
}

export interface QueueCounts {
  readonly name: string;
  /** Waiting to run, a retry included. */
  readonly queued: number;
  readonly active: number;
  /** Failed for good, as far as the queue still remembers them. */
  readonly failed: number;
  /**
   * Every job the queue holds, the finished ones it still keeps included, as of the queue's last
   * maintenance pass: a figure for a dashboard, not for a test of what just ran.
   */
  readonly total: number;
  /** How long the oldest job ready to run had waited, as of the last pass; null until one counted. */
  readonly oldestWaitSeconds: number | null;
}

/** A job that failed for good, as the queue still remembers it. */
export interface FailedJob {
  readonly id: string;
  readonly data: unknown;
  readonly priority: number;
  /** How many times it was tried. */
  readonly attempts: number;
  readonly createdAt: Date;
  readonly failedAt: Date | null;
  /** What the last attempt said, when it said anything. */
  readonly error: string | undefined;
}

export interface JobQueue {
  /**
   * Makes sure the queue exists with these settings. Idempotent, and run by every process at
   * start, so that a change of settings reaches the queue with the next deployment.
   */
  ensureQueue(name: string, settings: QueueSettings): Promise<void>;
  /** Queues a job. `undefined` when the singleton key kept it out. */
  send(name: string, data: object, options?: SendOptions): Promise<string | undefined>;
  /**
   * Runs `handler` on the jobs of the queue, one job per call, as they come in priority order. A
   * handler that throws fails the attempt, and the queue tries the job again within its settings.
   */
  work(
    name: string,
    options: WorkOptions,
    handler: (job: QueuedJob) => Promise<void>,
  ): Promise<void>;
  /**
   * Queues a job on a schedule, named by `key`: at each time the cron expression names, one job
   * with `data`, with the singleton key `key` so that a run that has not happened yet is not
   * queued twice. Takes effect only on a process that runs the schedules (the worker).
   */
  schedule(name: string, cron: string, data: object, key: string): Promise<void>;
  /** The counts of these queues, read fresh. */
  counts(names: readonly string[]): Promise<QueueCounts[]>;
  /** The jobs of the queue that failed for good, newest first, at most `limit`. */
  failures(name: string, limit: number): Promise<FailedJob[]>;
  /** Stops taking jobs, waits for the running ones up to `timeoutMs`, and lets the queue go. */
  stop(options?: { readonly timeoutMs?: number }): Promise<void>;
}

export interface JobQueueOptions {
  /**
   * What this process does with the queue besides sending: the worker also runs the schedules
   * and the queue's own maintenance, which one process has to and every other may leave alone.
   */
  readonly role: "api" | "worker";
  /** Shows up in `pg_stat_activity` on the queue's own statements. */
  readonly applicationName?: string;
  /** What the queue reports: a lost connection, a failed maintenance pass. */
  readonly onError: (error: Error) => void;
  readonly onWarning?: ((message: string) => void) | undefined;
}

/** How many of a queue's remembered jobs are looked through for the failed ones. */
const FAILURES_SCAN_LIMIT = 5000;

/** The message of what a failed attempt threw, as the queue stored it; nothing else of it. */
function errorOf(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const message = (output as { readonly message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

/**
 * Installs the queue's schema, or brings it to the version this build ships, on a database the
 * migrations of this package have run on. The migrate role runs it; a process that uses the
 * queue refuses to start where this has not run.
 */
export async function installJobQueue(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema: JOB_QUEUE_SCHEMA,
    application_name: "skillcdn-migrate",
    max: 2,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  // The install runs on a connection of its own, so a failure here is thrown, not emitted.
  boss.on("error", () => {});
  await boss.start();
  await boss.stop({ graceful: false, timeout: 1000 });
}

/**
 * The queue on the pool of `database`, without migrating: the schema has to be there already.
 * Rejects when it is not, or when the database cannot be reached.
 */
export async function createJobQueue(
  database: Database,
  options: JobQueueOptions,
): Promise<JobQueue> {
  const pool = poolOf(database);
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    schema: JOB_QUEUE_SCHEMA,
    application_name: options.applicationName ?? `skillcdn-${options.role}`,
    migrate: false,
    supervise: options.role === "worker",
    schedule: options.role === "worker",
  });
  boss.on("error", options.onError);
  if (options.onWarning !== undefined) {
    const warn = options.onWarning;
    boss.on("warning", (warning) => warn(warning.message));
  }
  await boss.start();
  return {
    async ensureQueue(name, settings) {
      const queue = {
        retryLimit: settings.retryLimit,
        retryDelay: settings.retryDelaySeconds,
        retryBackoff: true,
        expireInSeconds: settings.expireInSeconds,
      };
      // Creating a queue that exists changes nothing, so the settings are written after.
      await boss.createQueue(name, { policy: "stately", ...queue });
      await boss.updateQueue(name, queue);
    },
    async send(name, data, options = {}) {
      const id = await boss.send(name, data, {
        ...(options.priority === undefined ? {} : { priority: options.priority }),
        ...(options.singletonKey === undefined ? {} : { singletonKey: options.singletonKey }),
      });
      return id ?? undefined;
    },
    async work(name, options, handler) {
      await boss.work(
        name,
        {
          batchSize: 1,
          localConcurrency: options.concurrency ?? 1,
          pollingIntervalSeconds: options.pollSeconds ?? 2,
        },
        async ([job]) => {
          if (job === undefined) {
            return;
          }
          await handler({
            id: job.id,
            data: job.data,
            attempt: job.retryCount,
            signal: job.signal,
          });
        },
      );
    },
    async schedule(name, cron, data, key) {
      await boss.schedule(name, cron, data, { key, singletonKey: key });
    },
    async counts(names) {
      const counts: QueueCounts[] = [];
      for (const name of names) {
        const [stats] = await boss.getQueueStats(name, { force: true });
        counts.push({
          name,
          queued: stats?.queuedCount ?? 0,
          active: stats?.activeCount ?? 0,
          failed: stats?.failedCount ?? 0,
          total: stats?.totalCount ?? 0,
          oldestWaitSeconds: stats?.readyOldestSeconds ?? null,
        });
      }
      return counts;
    },
    async failures(name, limit) {
      // The queue lists jobs oldest first and by every state; the failed ones are picked out
      // here, from what it still keeps, which its retention bounds.
      const jobs = await boss.findJobs(name, { limit: FAILURES_SCAN_LIMIT });
      return jobs
        .filter((job) => job.state === "failed")
        .sort((a, b) => (b.completedOn?.getTime() ?? 0) - (a.completedOn?.getTime() ?? 0))
        .slice(0, limit)
        .map((job) => ({
          id: job.id,
          data: job.data,
          priority: job.priority,
          attempts: job.retryCount + 1,
          createdAt: job.createdOn,
          failedAt: job.completedOn,
          error: errorOf(job.output),
        }));
    },
    async stop(options = {}) {
      await boss.stop({ close: false, graceful: true, timeout: options.timeoutMs ?? 30_000 });
    },
  };
}
