import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Database, drizzleOf } from "./client.js";
import { createJobQueue, JOB_QUEUE_SCHEMA, type JobQueue } from "./jobs.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

// The job queue (ADR-0064) on a database the migrations ran on: its schema is there, a queue is
// made sure of as often as a process starts, a singleton key keeps a job from being queued twice,
// priority decides the order, and a failed job is tried again within the queue's settings.

let testDatabase: TestDatabase;
let database: Database;
let jobs: JobQueue;
const errors: Error[] = [];

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
  jobs = await createJobQueue(database, { role: "worker", onError: (error) => errors.push(error) });
});

afterAll(async () => {
  await jobs?.stop({ timeoutMs: 2000 });
  await testDatabase?.drop();
});

const data = (job: { readonly data: unknown }): number => (job.data as { n: number }).n;

describe("the job queue", () => {
  it("has its schema installed by the migrations", async () => {
    const result = await drizzleOf(database).execute<{ present: boolean }>(
      sql`select to_regclass(${`${JOB_QUEUE_SCHEMA}.job`}) is not null as present`,
    );
    expect(result.rows[0]?.present).toBe(true);
  });

  it("is made sure of a queue as often as asked, and keeps the latest settings", async () => {
    await jobs.ensureQueue("settings", {
      retryLimit: 2,
      retryDelaySeconds: 1,
      expireInSeconds: 60,
    });
    await jobs.ensureQueue("settings", {
      retryLimit: 4,
      retryDelaySeconds: 3,
      expireInSeconds: 90,
    });
    const result = await drizzleOf(database).execute<{
      retry_limit: number;
      retry_delay: number;
      expire_seconds: number;
      policy: string;
    }>(
      sql`select retry_limit, retry_delay, expire_seconds, policy from ${sql.identifier(JOB_QUEUE_SCHEMA)}.queue where name = 'settings'`,
    );
    expect(result.rows[0]).toMatchObject({
      retry_limit: 4,
      retry_delay: 3,
      expire_seconds: 90,
      policy: "stately",
    });
  });

  it("queues one job per singleton key and runs the higher priority first", async () => {
    await jobs.ensureQueue("order", { retryLimit: 0, retryDelaySeconds: 1, expireInSeconds: 60 });
    expect(await jobs.send("order", { n: 1 }, { singletonKey: "a", priority: 1 })).toBeDefined();
    expect(await jobs.send("order", { n: 1 }, { singletonKey: "a", priority: 1 })).toBeUndefined();
    expect(await jobs.send("order", { n: 2 }, { singletonKey: "b", priority: 3 })).toBeDefined();
    expect(await jobs.send("order", { n: 3 }, { singletonKey: "c", priority: 2 })).toBeDefined();
    const [counts] = await jobs.counts(["order"]);
    expect(counts).toMatchObject({ name: "order", queued: 3, active: 0, failed: 0 });

    const seen: number[] = [];
    await jobs.work("order", { pollSeconds: 0.5 }, async (job) => {
      seen.push(data(job));
    });
    await vi.waitFor(() => expect(seen).toEqual([2, 3, 1]), { timeout: 15_000 });
    // Once the job of a key is done, the key is free again.
    expect(await jobs.send("order", { n: 4 }, { singletonKey: "a" })).toBeDefined();
    await vi.waitFor(() => expect(seen).toEqual([2, 3, 1, 4]), { timeout: 15_000 });
  });

  it("tries a failed job again within its settings, then counts it as failed", async () => {
    await jobs.ensureQueue("retry", { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 });
    const attempts: number[] = [];
    await jobs.send("retry", { n: 1 }, { singletonKey: "r" });
    await jobs.work("retry", { pollSeconds: 0.5 }, async (job) => {
      attempts.push(job.attempt);
      throw new Error("not this time");
    });
    await vi.waitFor(() => expect(attempts).toEqual([0, 1]), { timeout: 20_000 });
    await vi.waitFor(
      async () => {
        const [counts] = await jobs.counts(["retry"]);
        expect(counts).toMatchObject({ name: "retry", queued: 0, active: 0, failed: 1 });
      },
      { timeout: 10_000 },
    );
  });

  it("writes a schedule down under its key", async () => {
    await jobs.ensureQueue("sweep", { retryLimit: 0, retryDelaySeconds: 1, expireInSeconds: 60 });
    await jobs.schedule("sweep", "0 * * * *", { kind: "sweep" }, "hourly");
    await jobs.schedule("sweep", "0 * * * *", { kind: "sweep" }, "hourly");
    const result = await drizzleOf(database).execute<{ key: string }>(
      sql`select key from ${sql.identifier(JOB_QUEUE_SCHEMA)}.schedule where name = 'sweep'`,
    );
    expect(result.rows.map((row) => row.key)).toEqual(["hourly"]);
  });

  it("reported nothing wrong on the way", () => {
    expect(errors).toEqual([]);
  });
});
