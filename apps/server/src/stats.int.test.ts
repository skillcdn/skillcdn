import { ROOT_PATH } from "@skillcdn/core";
import { createDatabase, findRepoByAlias, getRepoUsage, listTopRepositories } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mount } from "./mounts/mount-service.js";
import { UsageRecorder } from "./stats/usage-recorder.js";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

const DAY = "2026-07-04";
const clock = { now: () => new Date(`${DAY}T12:00:00Z`) };

function recorder(options: { maxBuffered?: number } = {}) {
  const logs: Record<string, unknown>[] = [];
  const stats = new UsageRecorder({
    database: testDatabase.database,
    clock,
    logger: pino(
      { level: "info" },
      { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
    ),
    ...options,
  });
  return { stats, logs };
}

describe("usage statistics", () => {
  it("count connections, tool calls and skill loads of an MCP session, per repository and day", async () => {
    const { stats } = recorder();
    const commit = fixtureCommits("stats").main;
    const h = createHarness(testDatabase, { host: createFixtureHost("stats"), stats });

    const client = await h.connect(`/gh/acme/multi-skill@${commit}/skills`);
    await client.listTools();
    await client.callTool({ name: "find", arguments: {} });
    await client.callTool({ name: "find", arguments: { query: "release" } });
    await client.callTool({ name: "get", arguments: { name: "release-notes" } });
    await client.callTool({ name: "get", arguments: { name: "no-such-skill" } });
    await client.callTool({ name: "read_file", arguments: { path: "release-notes/SKILL.md" } });
    await client.close();
    const again = await h.connect("/gh/acme/multi-skill");
    await again.close();

    // Browsing through the REST API is a person looking, not an agent working: not counted.
    await h.request(`/api/v1/mounts/gh/acme/multi-skill@${commit}`);
    await h.snapshots.idle();
    await stats.flush();

    const repo = await findRepoByAlias(testDatabase.database, {
      host: "gh",
      owner: "acme",
      repo: "multi-skill",
    });
    if (repo === undefined) {
      throw new Error("the repository was not saved");
    }
    const scope = { accountId: repo.accountId, repoId: repo.id };
    expect(await getRepoUsage(testDatabase.database, scope, { from: DAY, to: DAY })).toEqual([
      { metric: "connection", subject: "", count: 2 },
      // By where the skill lives in the repository, not by how it was mounted.
      { metric: "skill_load", subject: "skills/release-notes", count: 1 },
      { metric: "tool_call", subject: "find", count: 2 },
      { metric: "tool_call", subject: "get", count: 2 },
      { metric: "tool_call", subject: "read_file", count: 1 },
    ]);

    // Counting on: totals add up, they do not replace.
    const third = await h.connect("/gh/acme/multi-skill");
    await third.close();
    await stats.close();
    expect(
      await listTopRepositories(testDatabase.database, {
        metric: "connection",
        from: DAY,
        to: DAY,
        limit: 5,
      }),
    ).toEqual([{ host: "gh", owner: "Acme", name: "multi-skill", count: 3 }]);
  });

  it("writes early when many counters pile up, and survives a database that refuses", async () => {
    const { stats, logs } = recorder({ maxBuffered: 2 });
    const h = createHarness(testDatabase, { host: createFixtureHost("stats-early"), stats });
    const client = await h.connect(`/gh/acme/single-skill@${fixtureCommits("stats-early").main}`);
    await client.callTool({ name: "find", arguments: {} });
    await client.callTool({ name: "read_file", arguments: { path: "SKILL.md" } });
    await client.close();
    await h.snapshots.idle();
    await stats.flush();
    expect(logs.filter((line) => line.level === 40)).toEqual([]);

    // A database that cannot be reached: the counts are lost, the caller never notices.
    const unreachable = createDatabase({
      connectionString: "postgres://nobody:nothing@127.0.0.1:1/nowhere",
      maxConnections: 1,
      applicationName: "skillcdn-test",
    });
    const lost = new UsageRecorder({
      database: unreachable,
      clock,
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
    });
    const repo = await findRepoByAlias(testDatabase.database, {
      host: "gh",
      owner: "acme",
      repo: "single-skill",
    });
    if (repo === undefined) {
      throw new Error("the repository was not saved");
    }
    const mount: Mount = {
      address: { host: "gh", owner: "acme", repo: "single-skill", ref: undefined, path: ROOT_PATH },
      coordinates: { host: "gh", owner: "acme", repo: "single-skill" },
      repo,
      commit: "c".repeat(40),
      limits: {},
    };
    lost.count(mount, "connection");
    await expect(lost.close()).resolves.toBeUndefined();
    expect(logs.filter((line) => line.msg === "usage counts were not written")).toHaveLength(1);
    await unreachable.close();

    // What is not public is not counted at all.
    const { stats: careful } = recorder();
    careful.count(
      { ...mount, repo: { ...repo, repository: { ...repo.repository, visibility: "private" } } },
      "connection",
    );
    await careful.close();
    const scope = { accountId: repo.accountId, repoId: repo.id };
    expect(
      (await getRepoUsage(testDatabase.database, scope, { from: DAY, to: DAY })).filter(
        (total) => total.metric === "connection",
      ),
    ).toEqual([{ metric: "connection", subject: "", count: 1 }]);
  });
});
