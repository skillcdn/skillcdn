import type { HostRepository } from "@skillcdn/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addUsage,
  type Database,
  getRepoUsage,
  listTopRepositories,
  type RepoScope,
  saveRepository,
  usageDayOf,
} from "./index.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

const NOW = new Date("2026-03-10T23:59:30Z");
let nextHostId = 5000;

async function repository(
  name: string,
  patch: Partial<HostRepository> = {},
): Promise<RepoScope & { readonly name: string }> {
  nextHostId += 1;
  const saved = await saveRepository(
    database,
    { host: "gh", owner: `owner${nextHostId}`, repo: name.toLowerCase() },
    {
      hostRepoId: String(nextHostId),
      name,
      defaultBranch: "main",
      visibility: "public",
      owner: { hostAccountId: `7${nextHostId}`, login: `Owner${nextHostId}`, kind: "organization" },
      ...patch,
    },
    NOW,
  );
  return { accountId: saved.accountId, repoId: saved.id, name };
}

describe("usageDayOf", () => {
  it("is the day in UTC, whatever the clock on the wall says", () => {
    expect(usageDayOf(new Date("2026-03-10T23:59:59.999Z"))).toBe("2026-03-10");
    expect(usageDayOf(new Date("2026-03-11T00:00:00+09:00"))).toBe("2026-03-10");
  });
});

describe("usage counters", () => {
  it("add up across reports, processes and days", async () => {
    const scope = await repository("Counted");
    const call = (day: string, subject: string, count: number) =>
      ({ scope, day, metric: "tool_call", subject, count }) as const;

    await addUsage(database, [call("2026-03-09", "find", 2), call("2026-03-10", "find", 3)], NOW);
    // Two reports at once, as two replicas would send them, and one with a repeated counter.
    await Promise.all([
      addUsage(database, [call("2026-03-10", "find", 5), call("2026-03-10", "get", 1)], NOW),
      addUsage(database, [call("2026-03-10", "find", 1), call("2026-03-10", "find", 1)], NOW),
      addUsage(
        database,
        [{ scope, day: "2026-03-10", metric: "connection", subject: "", count: 4 }],
        NOW,
      ),
    ]);
    // Nothing to add is nothing to write.
    await addUsage(database, [call("2026-03-10", "find", 0), call("2026-03-10", "find", -3)], NOW);
    await addUsage(database, [], NOW);

    expect(await getRepoUsage(database, scope, { from: "2026-03-10", to: "2026-03-10" })).toEqual([
      { metric: "connection", subject: "", count: 4 },
      { metric: "tool_call", subject: "find", count: 10 },
      { metric: "tool_call", subject: "get", count: 1 },
    ]);
    expect(
      await getRepoUsage(database, scope, { from: "2026-03-01", to: "2026-03-31" }),
    ).toContainEqual({ metric: "tool_call", subject: "find", count: 12 });
    expect(await getRepoUsage(database, scope, { from: "2026-04-01", to: "2026-04-30" })).toEqual(
      [],
    );
  });

  it("belong to one repository of one account", async () => {
    const mine = await repository("Mine");
    const theirs = await repository("Theirs");
    await addUsage(
      database,
      [{ scope: mine, day: "2026-03-10", metric: "skill_load", subject: "skills/a", count: 7 }],
      NOW,
    );
    const range = { from: "2026-03-10", to: "2026-03-10" };
    expect(await getRepoUsage(database, theirs, range)).toEqual([]);
    expect(await getRepoUsage(database, { ...mine, accountId: theirs.accountId }, range)).toEqual(
      [],
    );
    expect(await getRepoUsage(database, mine, range)).toHaveLength(1);
  });

  it("survive text that looks like SQL", async () => {
    const scope = await repository("Hostile");
    const subject = "skills/'; drop table usage_daily; --";
    await addUsage(
      database,
      [{ scope, day: "2026-03-10", metric: "skill_load", subject, count: 1 }],
      NOW,
    );
    expect(await getRepoUsage(database, scope, { from: "2026-03-10", to: "2026-03-10" })).toEqual([
      { metric: "skill_load", subject, count: 1 },
    ]);
  });
});

describe("listTopRepositories", () => {
  it("ranks public repositories by one metric in a range of days, and no others", async () => {
    const busy = await repository("Busy");
    const quiet = await repository("Quiet");
    const secret = await repository("Secret", { visibility: "private" });
    const connections = (scope: RepoScope, day: string, count: number) =>
      ({ scope, day, metric: "connection", subject: "", count }) as const;
    await addUsage(
      database,
      [
        connections(busy, "2026-05-01", 40),
        connections(busy, "2026-05-02", 2),
        connections(quiet, "2026-05-02", 9),
        connections(secret, "2026-05-02", 1000),
        // Outside the range, and another metric: neither counts.
        connections(quiet, "2026-06-01", 500),
        { scope: quiet, day: "2026-05-02", metric: "tool_call", subject: "find", count: 900 },
      ],
      NOW,
    );

    const top = await listTopRepositories(database, {
      metric: "connection",
      from: "2026-05-01",
      to: "2026-05-31",
      limit: 10,
    });
    expect(top.map((row) => [row.name, row.count])).toEqual([
      ["Busy", 42],
      ["Quiet", 9],
    ]);
    expect(top[0]).toMatchObject({ host: "gh", owner: expect.stringMatching(/^Owner/) });
    expect(
      await listTopRepositories(database, {
        metric: "connection",
        from: "2026-05-01",
        to: "2026-05-31",
        limit: 1,
      }),
    ).toHaveLength(1);
  });
});
