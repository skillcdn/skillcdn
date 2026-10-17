import { ROOT_PATH } from "@skillcdn/core";
import {
  createDatabase,
  findRepoByAlias,
  getRepoUsage,
  getServiceUsage,
  listTopRepositories,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as z from "zod";
import type { Mount } from "./mounts/mount-service.js";
import { OTHER_APP, UsageRecorder } from "./stats/usage-recorder.js";
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
  it("count connections, tool calls, skill loads and file reads of an MCP session, per repository and day", async () => {
    const { stats } = recorder();
    const commit = fixtureCommits("stats").main;
    const h = createHarness(testDatabase, { host: createFixtureHost("stats"), stats });

    const client = await h.connect(`/gh/acme/multi-skill@${commit}/skills`);
    await client.listTools();
    await client.callTool({ name: "browse_repo", arguments: {} });
    await client.callTool({ name: "search_repo", arguments: { query: "release" } });
    await client.callTool({
      name: "load_skill",
      arguments: { path: "skills/release-notes/SKILL.md" },
    });
    await client.callTool({
      name: "load_skill",
      arguments: { path: "skills/no-such-skill/SKILL.md" },
    });
    await client.callTool({
      name: "read_repo_file",
      arguments: { path: "skills/release-notes/SKILL.md" },
    });
    await client.callTool({
      name: "read_repo_file",
      arguments: { path: "skills/release-notes/references/style.md" },
    });
    // The next page of a file is the same read.
    await client.callTool({
      name: "read_repo_file",
      arguments: { path: "skills/release-notes/references/style.md", offset: 10, limit: 20 },
    });
    // The skills extension reads from the same index and counts the same way: a skill's
    // document is a load of the skill, whichever way it is asked for, and any other file a
    // read of its path.
    const skillUri = "skill://gh/acme/multi-skill/skills/release-notes/SKILL.md";
    await client.request(
      { method: "skills/get", params: { uri: skillUri } },
      z.looseObject({ skill: z.looseObject({ uri: z.string() }) }),
    );
    await client.readResource({ uri: skillUri });
    await client.readResource({
      uri: "skill://gh/acme/multi-skill/skills/release-notes/references/style.md",
    });
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
    const calls = [
      { metric: "tool_call", subject: "browse_repo", count: 1 },
      { metric: "tool_call", subject: "load_skill", count: 2 },
      { metric: "tool_call", subject: "read_repo_file", count: 3 },
      { metric: "tool_call", subject: "resources/read", count: 2 },
      { metric: "tool_call", subject: "search_repo", count: 1 },
      { metric: "tool_call", subject: "skills/get", count: 1 },
    ];
    expect(await getRepoUsage(testDatabase.database, scope, { from: DAY, to: DAY })).toEqual([
      { metric: "connection", subject: "", count: 2 },
      // By where the file and the skill live in the repository, not by how they were mounted.
      { metric: "file_read", subject: "skills/release-notes/references/style.md", count: 2 },
      { metric: "skill_load", subject: "skills/release-notes", count: 4 },
      ...calls,
    ]);
    // The deployment's totals: the same, without a path, which would name the repository.
    expect(await getServiceUsage(testDatabase.database, { from: DAY, to: DAY })).toEqual([
      { day: DAY, metric: "connection", subject: "", count: 2 },
      { day: DAY, metric: "file_read", subject: "", count: 2 },
      { day: DAY, metric: "skill_load", subject: "", count: 4 },
      ...calls.map((call) => ({ day: DAY, ...call })),
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

  it("count distinct clients by a keyed hash of their address, folded when the day is over", async () => {
    let day = "2026-07-10";
    const movingClock = { now: () => new Date(`${day}T12:00:00Z`) };
    const logs: Record<string, unknown>[] = [];
    const stats = new UsageRecorder({
      database: testDatabase.database,
      clock: movingClock,
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
    });
    const commit = fixtureCommits("stats-clients").main;
    const h = createHarness(testDatabase, { host: createFixtureHost("stats-clients"), stats });
    const address = `/gh/acme/multi-skill@${commit}/skills`;

    // Two clients at one address, one of them twice; a client that says nothing about itself.
    for (const peer of ["203.0.113.7", "203.0.113.7", "2001:db8::1", undefined]) {
      const client = await h.connect(address, peer === undefined ? {} : { peer });
      await client.callTool({ name: "browse_repo", arguments: {} });
      await client.close();
    }
    // A client of the current revision, which has no handshake and names its app in every
    // request instead.
    const modern = await h.connect(address, { peer: "198.51.100.5", revision: "current" });
    await modern.callTool({ name: "browse_repo", arguments: {} });
    await modern.close();
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
    const clientsOn = async (from: string, to: string) =>
      (await getRepoUsage(testDatabase.database, scope, { from, to })).filter(
        (total) => total.metric === "client",
      );
    // Today is still being counted: nothing to show yet, and nothing stored that names a client.
    expect(await clientsOn(day, day)).toEqual([]);
    expect(JSON.stringify(logs)).not.toContain("203.0.113.7");

    // The next day, the first write folds the day before into a count.
    const firstDay = day;
    day = "2026-07-11";
    const again = await h.connect(address, { peer: "203.0.113.7" });
    await again.close();
    await stats.close();
    expect(await clientsOn(firstDay, firstDay)).toEqual([
      { metric: "client", subject: "", count: 3 },
    ]);
    expect(await clientsOn(day, day)).toEqual([]);
    // The deployment counts the same clients once each, whatever they used, by the app they
    // named: the one in the handshake and the one in the request alike.
    expect(
      (await getServiceUsage(testDatabase.database, { from: firstDay, to: firstDay })).filter(
        (total) => total.metric === "client" || total.metric === "client_app",
      ),
    ).toEqual([
      { day: firstDay, metric: "client", subject: "", count: 3 },
      { day: firstDay, metric: "client_app", subject: "skillcdn-test", count: 3 },
    ]);
    expect(logs.filter((line) => line.level === 40)).toEqual([]);
  });

  it("writes early when many counters pile up, and survives a database that refuses", async () => {
    const { stats, logs } = recorder({ maxBuffered: 2 });
    const h = createHarness(testDatabase, { host: createFixtureHost("stats-early"), stats });
    const client = await h.connect(`/gh/acme/single-skill@${fixtureCommits("stats-early").main}`);
    await client.callTool({ name: "browse_repo", arguments: {} });
    await client.callTool({ name: "read_repo_file", arguments: { path: "SKILL.md" } });
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
      verified: false,
      image: undefined,
      trustedUntil: undefined,
      repository: "acme/single-skill",
      description: undefined,
      sourceUrl: (path) => `https://github.com/acme/single-skill/blob/main/${path}`,
      rawUrl: (path) => `https://raw.githubusercontent.com/acme/single-skill/main/${path}`,
    };
    lost.count(mount, "connection");
    await expect(lost.close()).resolves.toBeUndefined();
    expect(logs.filter((line) => line.msg === "usage counts were not written")).toHaveLength(1);
    await unreachable.close();

    // What is not public is not counted for the public; it counts for the deployment, whose
    // totals name no repository.
    const serviceConnections = async () =>
      (await getServiceUsage(testDatabase.database, { from: DAY, to: DAY })).find(
        (total) => total.metric === "connection",
      )?.count ?? 0;
    const before = await serviceConnections();
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
    expect(await serviceConnections()).toBe(before + 1);
  });

  it("writes down the names of client apps, as many as the bound allows, and the rest as other", async () => {
    let day = "2026-07-20";
    const movingClock = { now: () => new Date(`${day}T12:00:00Z`) };
    const stats = new UsageRecorder({
      database: testDatabase.database,
      clock: movingClock,
      logger: pino({ level: "silent" }),
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
      commit: "d".repeat(40),
      limits: {},
      verified: false,
      image: undefined,
      trustedUntil: undefined,
      repository: "acme/single-skill",
      description: undefined,
      sourceUrl: (path) => `https://github.com/acme/single-skill/blob/main/${path}`,
      rawUrl: (path) => `https://raw.githubusercontent.com/acme/single-skill/main/${path}`,
    };
    // 203 clients at addresses of their own: 201 apps with names of their own, of which the
    // last is past the bound; one that names nothing; one that names the first app again.
    for (let index = 0; index < 203; index += 1) {
      const app = index === 201 ? undefined : index === 202 ? "App 0" : `App ${index}`;
      stats.client(mount, `10.0.${Math.floor(index / 256)}.${index % 256}`, app);
    }
    day = "2026-07-21";
    await stats.close();

    const apps = (
      await getServiceUsage(testDatabase.database, { from: "2026-07-20", to: "2026-07-20" })
    ).filter((total) => total.metric === "client_app");
    expect(apps).toHaveLength(202);
    expect(apps.reduce((sum, total) => sum + total.count, 0)).toBe(203);
    expect(apps.find((total) => total.subject === "app 0")?.count).toBe(2);
    expect(apps.find((total) => total.subject === OTHER_APP)?.count).toBe(1);
    expect(apps.find((total) => total.subject === "")?.count).toBe(1);
    expect(apps.find((total) => total.subject === "app 200")).toBeUndefined();
  });
});
