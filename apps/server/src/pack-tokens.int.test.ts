import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoByAlias, type JobQueue, markHostRepositoriesNotPublic } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACK_TOKEN_PREFIX } from "./auth/pack-tokens.js";
import { listDirectoryPacks } from "./directory/directory-host.js";
import { loadWebBundle, type WebBundle } from "./http/web.js";
import { createIndexAhead } from "./jobs/index-ahead.js";
import type { IndexJob } from "./jobs/queues.js";
import { createWorker, type Worker } from "./jobs/worker.js";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";
import { createWebBuild, type WebBuildFixture } from "./testing/web-build.js";

// A deployment that reads the packs of its own directory with a token only (ADR-0088): to a
// request that presents nothing, a pack and a name that is nothing are one answer, over REST,
// over MCP and on the pages; the operator makes a token for one pack or for every pack through
// the admin API, and it reads exactly that, as what is not public is read; a token ends when it
// is removed and at its time; nothing that lists what everyone is served names such a pack; and
// the worker indexes the directory all the same.

const ADMIN = "an-admin-token-of-at-least-thirty-two-characters";
const CHARTS = "/local/harbour/charts";
const NOTICES = "/local/harbour/notices";
const NOTHING = "/local/harbour/nothing";
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "a-test", version: "1" },
  },
});

let testDatabase: TestDatabase;
let root: string;
let build: WebBuildFixture;
let web: WebBundle;
const closing: Worker[] = [];

/** A document pack of the directory, with one chapter and the original it was made from. */
function writePack(owner: string, name: string, title: string): void {
  const pack = join(root, owner, name);
  mkdirSync(join(pack, "docs", "sources"), { recursive: true });
  writeFileSync(
    join(pack, "SKILLCDN.md"),
    `---\nname: ${title}\ndescription: ${title}, as a pack of documents for the harbour's agents.\ndocuments:\n  - docs\nlicense: MIT\n---\n`,
  );
  writeFileSync(join(pack, "docs", "README.md"), `# ${title}\n\n- tides.md\n`);
  writeFileSync(
    join(pack, "docs", "tides.md"),
    `---\ntitle: Tides\nsource: sources/tides.pdf\n---\n# Tides\n\nThe gauge at the east quay reads highest after the new moon.\n`,
  );
  writeFileSync(join(pack, "docs", "sources", "tides.pdf"), "%PDF-1.7 pretend");
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  build = createWebBuild();
  web = await loadWebBundle(build.root, { publicUrl: "https://skills.example" });
  root = mkdtempSync(join(tmpdir(), "skillcdn-guarded-"));
  writePack("harbour", "charts", "Charts");
  writePack("harbour", "notices", "Notices");
  writePack("quay", "ledger", "Ledger");
});
afterAll(async () => {
  for (const worker of closing) {
    await worker.close(1000);
  }
  rmSync(root, { recursive: true, force: true });
  build?.remove();
  await testDatabase?.drop();
});

const guarded = (options: HarnessOptions = {}): Harness =>
  createHarness(testDatabase, {
    packsRoot: root,
    packsAccess: "token",
    adminToken: ADMIN,
    ...options,
  });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function codeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

/** Makes a token through the admin API, as the operator does, and answers with its secret. */
async function makeToken(
  h: Harness,
  body: { address: string; label: string; expiresInDays?: number | null },
): Promise<{ token: string; id: string }> {
  const response = await h.request("/admin/v1/pack-tokens", {
    method: "POST",
    headers: { ...bearer(ADMIN), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const made = (await response.json()) as { token: string; item: { id: string } };
  expect(made.token.startsWith(PACK_TOKEN_PREFIX)).toBe(true);
  return { token: made.token, id: made.item.id };
}

const mcp = (h: Harness, address: string, headers: Record<string, string> = {}) =>
  h.request(address, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: INITIALIZE,
  });

/** The mount over REST once its index is ready, for whoever the headers say asks. */
async function ready(h: Harness, address: string, headers: Record<string, string>) {
  await expect
    .poll(
      async () => {
        const response = await h.request(`/api/v1/mounts${address}`, { headers });
        if (response.status !== 200) return response.status;
        const body = (await response.json()) as { index: { status: string } };
        return body.index.status;
      },
      { timeout: 15_000, interval: 200 },
    )
    .toBe("ready");
  return h.request(`/api/v1/mounts${address}`, { headers });
}

describe("a deployment that reads the packs of its directory with a token only", () => {
  it("answers a request that presents nothing the same for a pack and for a name that is nothing", async () => {
    const h = guarded();
    for (const address of [CHARTS, NOTHING]) {
      // REST: not found, and never the challenge.
      const rest = await h.request(`/api/v1/mounts${address}`);
      expect(rest.status).toBe(404);
      expect(rest.headers.get("www-authenticate")).toBeNull();
      expect(await codeOf(rest)).toBe("mount.repo_not_found");
      // MCP: the challenge, which says that a credential is asked for and nothing else.
      const asked = await mcp(h, address);
      expect(asked.status).toBe(401);
      expect(asked.headers.get("www-authenticate")).toBe('Bearer realm="packs"');
      expect(asked.headers.get("cache-control")).toBe("no-store");
      expect(await codeOf(asked)).toBe("auth.required");
      // The pages show nobody a pack: a browser has no token to present.
      expect((await guarded({ web }).request(address, { headers: BROWSER })).status).toBe(404);
      // A credential that is no token of this pack is one that is no good, whatever it is.
      for (const header of [`Bearer ${PACK_TOKEN_PREFIX}not-a-token`, "Bearer other", "Basic x"]) {
        const wrong = await h.request(`/api/v1/mounts${address}`, {
          headers: { authorization: header },
        });
        expect(wrong.status).toBe(401);
        expect(wrong.headers.get("www-authenticate")).toContain('error="invalid_token"');
        expect(await codeOf(wrong)).toBe("auth.invalid_token");
        expect((await mcp(h, address, { authorization: header })).status).toBe(401);
      }
    }
    // The original of a chapter is no more public than the chapter.
    expect((await h.request(`/api/v1/raw${CHARTS}?path=docs/sources/tides.pdf`)).status).toBe(404);
  });

  it("reads one pack with the token the operator made for it, as what is not public is read", async () => {
    const h = guarded();
    const { token } = await makeToken(h, { address: CHARTS, label: "the survey agent" });
    const mount = await ready(h, CHARTS, bearer(token));
    expect(mount.status).toBe(200);
    expect(mount.headers.get("cache-control")).toContain("no-store");
    expect(await mount.json()).toMatchObject({ repository: { visibility: "private" } });
    // Over MCP, and the original as an attachment, with the same token.
    expect((await mcp(h, CHARTS, bearer(token))).status).toBe(200);
    const original = await h.request(`/api/v1/raw${CHARTS}?path=docs/sources/tides.pdf`, {
      headers: bearer(token),
    });
    expect(original.status).toBe(200);
    expect(await original.text()).toBe("%PDF-1.7 pretend");
    // It is the token of one pack: at another it is a credential that is no good, and at a
    // name that is nothing as well.
    for (const address of [NOTICES, NOTHING]) {
      const other = await h.request(`/api/v1/mounts${address}`, { headers: bearer(token) });
      expect(other.status).toBe(401);
      expect(await codeOf(other)).toBe("auth.invalid_token");
    }
    // Nothing that names what everyone is served names it: the search across packs finds
    // nothing of it, and the pages still show nobody a pack.
    const search = await h.request("/api/v1/search?query=gauge%20east%20quay");
    expect(search.status).toBe(200);
    expect(await search.json()).toMatchObject({ items: [] });
    expect((await guarded({ web }).request(CHARTS, { headers: BROWSER })).status).toBe(404);
  });

  it("reads every pack with a token made for the directory, and a name that is nothing is not found", async () => {
    const h = guarded();
    const { token } = await makeToken(h, { address: "/local", label: "the harbour master" });
    expect((await ready(h, CHARTS, bearer(token))).status).toBe(200);
    expect((await ready(h, NOTICES, bearer(token))).status).toBe(200);
    const nothing = await h.request(`/api/v1/mounts${NOTHING}`, { headers: bearer(token) });
    expect(nothing.status).toBe(404);
    expect(await codeOf(nothing)).toBe("mount.repo_not_found");
  });

  it("ends a token when the operator removes it, and at the time it was given", async () => {
    let now = Date.parse("2026-06-01T00:00:00Z");
    const h = guarded({ clock: { now: () => new Date(now) } });
    const removed = await makeToken(h, { address: CHARTS, label: "to be removed" });
    const timed = await makeToken(h, { address: CHARTS, label: "a week", expiresInDays: 7 });
    for (const { token } of [removed, timed]) {
      expect((await h.request(`/api/v1/mounts${CHARTS}`, { headers: bearer(token) })).status).toBe(
        200,
      );
    }
    // The list names each token by what it reads and who holds it, never by its secret.
    const list = await h.request("/admin/v1/pack-tokens", { headers: bearer(ADMIN) });
    const { items } = (await list.json()) as { items: Record<string, unknown>[] };
    expect(items.find((item) => item.id === timed.id)).toMatchObject({
      address: CHARTS,
      label: "a week",
      expiresAt: "2026-06-08T00:00:00.000Z",
    });
    expect(JSON.stringify(items)).not.toContain(PACK_TOKEN_PREFIX);

    const gone = await h.request(`/admin/v1/pack-tokens/${removed.id}`, {
      method: "DELETE",
      headers: bearer(ADMIN),
    });
    expect(gone.status).toBe(204);
    expect(
      (await h.request(`/api/v1/mounts${CHARTS}`, { headers: bearer(removed.token) })).status,
    ).toBe(401);
    expect(
      (
        await h.request(`/admin/v1/pack-tokens/${removed.id}`, {
          method: "DELETE",
          headers: bearer(ADMIN),
        })
      ).status,
    ).toBe(404);

    now += 8 * 86_400_000;
    expect(
      (await h.request(`/api/v1/mounts${CHARTS}`, { headers: bearer(timed.token) })).status,
    ).toBe(401);
  });

  it("makes a token for a pack of the directory only, and for the operator only", async () => {
    const h = guarded();
    const post = (body: unknown, headers: Record<string, string> = bearer(ADMIN)) =>
      h.request("/admin/v1/pack-tokens", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post({ address: CHARTS, label: "x" }, {})).status).toBe(401);
    for (const address of ["/gh/acme/single-skill", `${CHARTS}/docs`, "/local/harbour", "nope"]) {
      const refused = await post({ address, label: "x" });
      expect(refused.status).toBe(400);
      expect(await codeOf(refused)).toBe("token.not_a_pack");
    }
    for (const body of [{ address: CHARTS }, { address: CHARTS, label: "x", expiresInDays: 0 }]) {
      const refused = await post(body);
      expect(refused.status).toBe(400);
      expect(await codeOf(refused)).toBe("token.invalid");
    }
  });

  it("is indexed by the worker with nobody asking, and closes what was served to everyone before", async () => {
    // The worker reads its own directory, whatever its packs are to everyone.
    const sent: IndexJob[] = [];
    const jobs: JobQueue = {
      ensureQueue: async () => {},
      send: async (_name, data) => {
        sent.push(data as IndexJob);
        return "sent";
      },
      work: async () => {},
      schedule: async () => {},
      unschedule: async () => {},
      waiting: async () => [],
      reorder: async () => false,
      counts: async () => [],
      failures: async () => [],
      stop: async () => {},
    };
    const logger = pino({ level: "silent" });
    const clock = { now: () => new Date() };
    const ahead = { scope: "listed", intervalMs: 900_000, limit: 50 } as const;
    const worker = createWorker(
      {
        mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
        indexing: {
          waitMs: 10_000,
          concurrency: 2,
          leaseMs: 60_000,
          ahead,
          retentionMs: 0,
          limits: {
            maxTreeEntries: 1000,
            maxIndexedFiles: 100,
            maxIndexedFileBytes: 262_144,
            maxIndexedTotalBytes: 1_048_576,
            maxReadableFileBytes: 262_144,
            maxArchiveBytes: 10_000_000,
          },
        },
        embedConcurrency: 1,
        scope: "none",
        packs: { root, access: "token" },
      },
      {
        database: testDatabase.database,
        jobs,
        gitHost: createFixtureHost("guarded-worker"),
        embedder: undefined,
        clock,
        logger,
      },
    );
    closing.push(worker);
    const indexAhead = createIndexAhead({
      database: testDatabase.database,
      jobs,
      mounts: worker.mounts,
      snapshots: worker.snapshots,
      lists: { listedKeys: async () => [] },
      config: ahead,
      directoryPacks: (limit) => listDirectoryPacks(root, limit),
      clock,
      logger,
    });
    await indexAhead.look();
    const job = sent.find(({ address }) => address === "/local/quay/ledger");
    if (job === undefined) throw new Error("the pack nobody asked for was not found");
    expect(await indexAhead.run(job)).toMatchObject({ refs: 1, indexed: 1 });
    const ledger = await findRepoByAlias(testDatabase.database, {
      host: "local",
      owner: "quay",
      repo: "ledger",
    });
    expect(ledger?.repository.visibility).toBe("private");

    // A deployment that served its directory to everyone and then asks for a token: what it
    // remembers as public is written down as public no longer, at start.
    const open = createHarness(testDatabase, { packsRoot: root, adminToken: ADMIN });
    expect((await h200(open, `/api/v1/mounts${NOTICES}`)).status).toBe(200);
    // No such routes where the directory is served to everyone.
    expect((await open.request("/admin/v1/pack-tokens", { headers: bearer(ADMIN) })).status).toBe(
      404,
    );
    const known = () =>
      findRepoByAlias(testDatabase.database, { host: "local", owner: "harbour", repo: "notices" });
    expect((await known())?.repository.visibility).toBe("public");
    expect(
      await markHostRepositoriesNotPublic(testDatabase.database, "local", new Date()),
    ).toBeGreaterThanOrEqual(1);
    expect((await known())?.repository.visibility).toBe("private");
  });
});

/** A request that is expected to be served, once what it asks for is known. */
async function h200(h: Harness, path: string): Promise<Response> {
  await expect
    .poll(async () => (await h.request(path)).status, { timeout: 15_000, interval: 200 })
    .toBe(200);
  return h.request(path);
}
