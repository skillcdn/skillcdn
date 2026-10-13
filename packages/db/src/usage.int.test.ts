import type { HostRepository } from "@skillcdn/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./client.js";
import {
  addServiceUsage,
  addServiceUsageClients,
  addUsage,
  addUsageClients,
  type Database,
  foldServiceUsageClients,
  foldUsageClients,
  getRepoUsage,
  getServiceUsage,
  listTopRepositories,
  listTopSubjects,
  type RepoScope,
  saveRepository,
  usageDayOf,
} from "./index.js";
import { usageClients, usageServiceClients } from "./schema.js";
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
      description: undefined,
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

    // The day being counted is not folded; the days before it are.
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

describe("the deployment's own counters", () => {
  it("add up without naming a repository, and are read per day", async () => {
    const call = (day: string, count: number) =>
      ({ day, metric: "tool_call", subject: "browse_repo", count }) as const;
    await addServiceUsage(
      database,
      [
        call("2026-09-01", 2),
        call("2026-09-01", 3),
        { day: "2026-09-01", metric: "skill_load", subject: "", count: 1 },
        { day: "2026-09-02", metric: "file_read", subject: "", count: 4 },
        { day: "2026-09-02", metric: "file_read", subject: "", count: 0 },
      ],
      NOW,
    );
    // Another process, later: it adds.
    await addServiceUsage(database, [call("2026-09-01", 1)], NOW);
    await addServiceUsage(database, [], NOW);
    expect(await getServiceUsage(database, { from: "2026-09-01", to: "2026-09-02" })).toEqual([
      { day: "2026-09-01", metric: "skill_load", subject: "", count: 1 },
      { day: "2026-09-01", metric: "tool_call", subject: "browse_repo", count: 6 },
      { day: "2026-09-02", metric: "file_read", subject: "", count: 4 },
    ]);
    expect(await getServiceUsage(database, { from: "2026-09-03", to: "2026-09-30" })).toEqual([]);
  });

  it("count distinct clients once across every repository, and by the app each named", async () => {
    const seen = (day: string, client: string, app: string) => ({ day, client, app });
    await addServiceUsageClients(
      database,
      [
        seen("2026-09-10", "a", ""),
        seen("2026-09-10", "b", "cursor"),
        // The same client in the same report, now with its app: the app wins.
        seen("2026-09-10", "a", "claude code"),
        seen("2026-09-11", "a", ""),
        seen("2026-09-11", "d", ""),
      ],
      NOW,
    );
    // Reported again by another process: the first name a client gave stays, a client written
    // without a name takes the one it is now seen with.
    await addServiceUsageClients(
      database,
      [
        seen("2026-09-10", "b", ""),
        seen("2026-09-10", "b", "something else"),
        seen("2026-09-11", "a", "codex"),
        seen("2026-09-11", "c", "codex"),
      ],
      NOW,
    );
    await addServiceUsageClients(database, [], NOW);

    await foldServiceUsageClients(database, "2026-09-11", NOW);
    expect(await getServiceUsage(database, { from: "2026-09-10", to: "2026-09-11" })).toEqual([
      { day: "2026-09-10", metric: "client", subject: "", count: 2 },
      { day: "2026-09-10", metric: "client_app", subject: "claude code", count: 1 },
      { day: "2026-09-10", metric: "client_app", subject: "cursor", count: 1 },
    ]);
    const handle = drizzleOf(database);
    expect(
      (
        await handle
          .select({ day: usageServiceClients.day, app: usageServiceClients.app })
          .from(usageServiceClients)
          .orderBy(usageServiceClients.client)
      ).map((row) => [row.day, row.app]),
    ).toEqual([
      ["2026-09-11", "codex"],
      ["2026-09-11", "codex"],
      ["2026-09-11", ""],
    ]);

    // Folding again moves nothing; the next day folds the rest, the unnamed app among them.
    await foldServiceUsageClients(database, "2026-09-11", NOW);
    await foldServiceUsageClients(database, "2026-09-12", NOW);
    expect(await getServiceUsage(database, { from: "2026-09-11", to: "2026-09-11" })).toEqual([
      { day: "2026-09-11", metric: "client", subject: "", count: 3 },
      { day: "2026-09-11", metric: "client_app", subject: "", count: 1 },
      { day: "2026-09-11", metric: "client_app", subject: "codex", count: 2 },
    ]);
    expect(await handle.select({ day: usageServiceClients.day }).from(usageServiceClients)).toEqual(
      [],
    );
  });
});

describe("listTopSubjects", () => {
  it("ranks the subjects of one metric across public repositories, and no others", async () => {
    const loaded = await repository("Loaded");
    const hidden = await repository("Hidden", { visibility: "private" });
    const load = (scope: RepoScope, day: string, subject: string, count: number) =>
      ({ scope, day, metric: "skill_load", subject, count }) as const;
    await addUsage(
      database,
      [
        load(loaded, "2026-10-01", "skills/a", 5),
        load(loaded, "2026-10-02", "skills/a", 1),
        load(loaded, "2026-10-01", "skills/b", 4),
        load(hidden, "2026-10-01", "skills/z", 100),
        { scope: loaded, day: "2026-10-01", metric: "file_read", subject: "docs/x.md", count: 9 },
        // Outside the range.
        load(loaded, "2026-11-01", "skills/c", 50),
      ],
      NOW,
    );
    const range = { from: "2026-10-01", to: "2026-10-31" };
    const skills = await listTopSubjects(database, { metric: "skill_load", ...range, limit: 10 });
    expect(skills.map((row) => [row.name, row.subject, row.count])).toEqual([
      ["Loaded", "skills/a", 6],
      ["Loaded", "skills/b", 4],
    ]);
    expect(await listTopSubjects(database, { metric: "file_read", ...range, limit: 1 })).toEqual([
      { host: "gh", owner: loaded.owner, name: "Loaded", subject: "docs/x.md", count: 9 },
    ]);
    expect(
      await listTopSubjects(database, { metric: "skill_load", ...range, limit: 10, minimum: 5 }),
    ).toEqual([expect.objectContaining({ subject: "skills/a" })]);
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
