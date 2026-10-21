import {
  allowEverything,
  parseAddress,
  restIndexNowSchema,
  restMyIndexSchema,
} from "@skillcdn/core";
import { createJobQueue, findRepoByAlias, type JobQueue } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRepositoryJob } from "./jobs/index-repository.js";
import { ensureJobQueues } from "./jobs/queues.js";
import { MountError, MountService } from "./mounts/mount-service.js";
import { fixtureCommits } from "./testing/fixture-host.js";
import { createFixtureLogin, type FixtureLogin } from "./testing/fixture-login.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

// What an administrator of a repository asks of its index (ADR-0064): the page learns whether the
// person signed in administers the repository at the host, and only such a person has it indexed
// now, a repository that is not public included, which the worker then resolves by its row.

let testDatabase: TestDatabase;
let jobs: JobQueue;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  jobs = await createJobQueue(testDatabase.database, { role: "api", onError: () => {} });
  await ensureJobQueues(jobs);
});

afterAll(async () => {
  await jobs?.stop({ timeoutMs: 2000 });
  await testDatabase?.drop();
});

const INDEX = "/api/v1/me/index";
const SECRET = "/gh/acme/secret-skills";
const KEY = { model: "test-model", dimensions: 4, sectioningVersion: 1 };

function harness(options: HarnessOptions = {}) {
  const login = options.login ?? createFixtureLogin();
  return { login, ...createHarness(testDatabase, { login, ...options }) };
}

let newcomers = 0;
/** A person of this test alone: what one test learns about a person stays out of the next. */
function newcomer(login: FixtureLogin, sees: string[], administers: string[] = []): string {
  newcomers += 1;
  const name = `indexer-${newcomers}`;
  login.people[name] = {
    user: { hostAccountId: String(8000 + newcomers), login: name, name: undefined },
    sees,
    administers,
  };
  return name;
}

const read = async (h: Pick<Harness, "request">, address: string, cookie?: string) =>
  h.request(`${INDEX}${address}`, cookie === undefined ? {} : { headers: { cookie } });

const ask = (
  h: Pick<Harness, "request" | "origin">,
  address: string,
  cookie: string,
  headers: Record<string, string> = { origin: h.origin },
) => h.request(`${INDEX}${address}`, { method: "POST", headers: { cookie, ...headers } });

describe("what a person may ask of a repository's index", () => {
  it("is told to an administrator, and nothing to anyone the repository is nothing to", async () => {
    const h = harness();
    const admin = await h.signIn(newcomer(h.login, ["secret-skills"], ["secret-skills"]));
    const reader = await h.signIn(newcomer(h.login, ["secret-skills"]));
    const stranger = await h.signIn(newcomer(h.login, []));
    expect((await read(h, SECRET)).status).toBe(401);
    expect(restMyIndexSchema.parse(await (await read(h, SECRET, admin)).json())).toEqual({
      administers: true,
    });
    expect(restMyIndexSchema.parse(await (await read(h, SECRET, reader)).json())).toEqual({
      administers: false,
    });
    // A stranger is answered as for a name that is nothing.
    const hidden = await read(h, SECRET, stranger);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });
    // A public repository is anyone's to read, and this person's to administer only if the
    // host says so, which it does not.
    expect(
      restMyIndexSchema.parse(await (await read(h, "/gh/acme/multi-skill", stranger)).json()),
    ).toEqual({ administers: false });
    // A repository is indexed whole: a path is refused before anything is asked.
    const withPath = await read(h, `${SECRET}/marketing`, admin);
    expect(withPath.status).toBe(400);
    expect(await withPath.json()).toMatchObject({ error: { code: "index.not_a_repository" } });
    expect(h.login.calls.repositoryPermission).toBe(3);
  });

  it("queues the repository once for its administrator, from the deployment's own pages, and the worker indexes it by its row", async () => {
    const h = harness({ embedding: { jobs, key: KEY, scope: "all", vectors: true } });
    const admin = await h.signIn(newcomer(h.login, ["secret-skills"], ["secret-skills"]));
    const reader = await h.signIn(newcomer(h.login, ["secret-skills"]));
    // The cookie alone is not enough: the request has to come from the site itself.
    const foreign = await ask(h, SECRET, admin, { origin: "https://elsewhere.example" });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "auth.forbidden_origin" } });
    const refused = await ask(h, SECRET, reader);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "index.not_administrator" } });

    const queued = await ask(h, SECRET, admin);
    expect(queued.status).toBe(202);
    expect(restIndexNowSchema.parse(await queued.json())).toEqual({ queued: true });
    const again = await ask(h, SECRET, admin);
    expect(again.status).toBe(202);
    expect(restIndexNowSchema.parse(await again.json())).toEqual({ queued: false });
    expect(JSON.stringify(h.logs)).toContain("repository designated for indexing");

    // The worker resolves the repository by its row, where the name is nothing to everyone.
    const known = await findRepoByAlias(testDatabase.database, {
      host: "gh",
      owner: "acme",
      repo: "secret-skills",
    });
    if (known === undefined) throw new Error("the repository was not resolved");
    const mounts = new MountService({
      database: testDatabase.database,
      gitHost: h.host,
      clock: { now: () => new Date() },
      entitlements: allowEverything,
      repoTtlMs: 60_000,
      refTtlMs: 60_000,
      staleGraceMs: 60_000,
      isVerified: async () => false,
      imageOf: async () => undefined,
    });
    const address = parseAddress(SECRET);
    if (!address.ok) throw new Error("the address of the test is not one");
    await expect(mounts.resolve(address.value)).rejects.toBeInstanceOf(MountError);
    const outcome = await indexRepositoryJob(
      {
        mounts,
        snapshots: h.snapshots,
        jobs,
        key: undefined,
        clock: { now: () => new Date() },
        logger: pino({ level: "silent" }),
      },
      { address: SECRET, accountId: known.accountId, repoId: known.id },
    );
    expect(outcome).toEqual({ commit: fixtureCommits().main, queued: false });
  });

  it("says that nothing can be asked where the deployment runs no worker", async () => {
    const h = harness();
    const admin = await h.signIn(newcomer(h.login, ["secret-skills"], ["secret-skills"]));
    const response = await ask(h, SECRET, admin);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "index.unavailable" } });
  });
});
