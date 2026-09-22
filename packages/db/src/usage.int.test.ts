import type { HostRepository } from "@skillcdn/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./client.js";
import {
  addUsage,
  addUsageClients,
  type Database,
  foldUsageClients,
  getRepoUsage,
  getUsageClientKey,
  listTopRepositories,
  type RepoScope,
  saveRepository,
  usageDayOf,
} from "./index.js";
import { usageClientKeys, usageClients } from "./schema.js";
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
): Promise<RepoScope & { readonly name: string; readonly owner: string }> {
  nextHostId += 1;
  const owner = `Owner${nextHostId}`;
  const saved = await saveRepository(
    database,
    { host: "gh", owner: owner.toLowerCase(), repo: name.toLowerCase() },
    {
      hostRepoId: String(nextHostId),
      name,
      defaultBranch: "main",
      visibility: "public",
      owner: { hostAccountId: `7${nextHostId}`, login: owner, kind: "organization" },
      ...patch,
    },
    NOW,
  );
  return { accountId: saved.accountId, repoId: saved.id, name, owner };
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

describe("distinct clients", () => {
  it("are keyed hashes for a day, folded into a count when the day is over", async () => {
    const one = await repository("One");
    const two = await repository("Two");
    let made = 0;
    const newKey = () => {
      made += 1;
      return `key-${made}`;
    };
    // Several processes ask for the key of a day at once: one key, whoever made it.
    const keys = await Promise.all([
      getUsageClientKey(database, "2026-08-01", newKey, NOW),
      getUsageClientKey(database, "2026-08-01", newKey, NOW),
      getUsageClientKey(database, "2026-08-01", newKey, NOW),
    ]);
    expect(new Set(keys).size).toBe(1);
    expect(await getUsageClientKey(database, "2026-08-01", newKey, NOW)).toBe(keys[0]);
    expect(await getUsageClientKey(database, "2026-08-02", newKey, NOW)).not.toBe(keys[0]);

    const seen = (scope: RepoScope, day: string, client: string) => ({ scope, day, client });
    await addUsageClients(
      database,
      [
        seen(one, "2026-08-01", "a"),
        seen(one, "2026-08-01", "b"),
        seen(one, "2026-08-01", "a"),
        seen(two, "2026-08-01", "a"),
        seen(one, "2026-08-02", "a"),
      ],
      NOW,
    );
    // Reported again by another process, or later the same day: still the same clients.
    await addUsageClients(
      database,
      [seen(one, "2026-08-01", "b"), seen(one, "2026-08-02", "c")],
      NOW,
    );
    await addUsageClients(database, [], NOW);

    // The day being counted is not folded; the days before it are, key included.
    await foldUsageClients(database, "2026-08-02", NOW);
    const range = { from: "2026-08-01", to: "2026-08-02" };
    expect(await getRepoUsage(database, one, range)).toEqual([
      { metric: "client", subject: "", count: 2 },
    ]);
    expect(await getRepoUsage(database, two, range)).toEqual([
      { metric: "client", subject: "", count: 1 },
    ]);
    const handle = drizzleOf(database);
    expect(
      (await handle.select({ day: usageClients.day }).from(usageClients)).map((row) => row.day),
    ).toEqual(["2026-08-02", "2026-08-02"]);
    expect(
      (await handle.select({ day: usageClientKeys.day }).from(usageClientKeys)).map(
        (row) => row.day,
      ),
    ).toEqual(["2026-08-02"]);

    // Folding again moves nothing and changes nothing; the next day adds to the counts.
    await foldUsageClients(database, "2026-08-02", NOW);
    await foldUsageClients(database, "2026-08-03", NOW);
    expect(await getRepoUsage(database, one, range)).toEqual([
      { metric: "client", subject: "", count: 4 },
    ]);
    expect(await listTopRepositories(database, { metric: "client", ...range, limit: 5 })).toEqual([
      { host: "gh", owner: one.owner, name: "One", count: 4 },
      { host: "gh", owner: two.owner, name: "Two", count: 1 },
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
    expect(
      await listTopRepositories(database, {
        metric: "connection",
        from: "2026-05-01",
        to: "2026-05-31",
        limit: 10,
        minimum: 10,
      }),
    ).toEqual([expect.objectContaining({ name: "Busy" })]);
  });
});
