import { restMountSchema } from "@skillcdn/core";
import {
  createTestDatabase,
  DEV_DATABASE_URL,
  markIndexVersion,
  type TestDatabase,
} from "@skillcdn/db/testing";
import { INDEX_VERSION, MIN_SERVABLE_INDEX_VERSION } from "@skillcdn/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

// A mount is served from the last indexed commit of its ref while the newest commit's index is
// not ready, and from a commit's index under the previous reading rules while it is rebuilt
// (ADR-0068): what every route and tool then names, and what a pinned address gets instead.

let testDatabase: TestDatabase;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await testDatabase?.drop();
});

/** Refs are resolved on every request here, so that a push is seen at once. */
const harness = (options: HarnessOptions = {}) =>
  createHarness(testDatabase, { ttlMs: 0, ...options });

const INDEXED_WITHIN = { timeout: 15_000, interval: 50 };
/** One repository per test: the ref cache is the repository's, and a test must not inherit another's history. */
const ADDRESS = "/gh/acme/multi-skill";
const SINGLE = "/gh/acme/single-skill";
const MANIFEST = "/gh/acme/with-manifest";
const DOCUMENTS = "/gh/acme/document-pack";

async function mountOf(h: Pick<Harness, "request">, address: string) {
  const response = await h.request(`/api/v1/mounts${address}`);
  expect(response.status).toBe(200);
  return restMountSchema.parse(await response.json());
}

/** Waits until the address is served from `commit` with nothing newer beside it. */
async function servedFrom(h: Pick<Harness, "request">, address: string, commit: string) {
  await expect
    .poll(async () => {
      const body = await mountOf(h, address);
      return body.index.status === "ready" && body.newest === null
        ? body.commit
        : body.index.status;
    }, INDEXED_WITHIN)
    .toBe(commit);
}

describe("a moving ref whose newest commit is not ready", () => {
  it("is served from the last indexed commit while the newest fails to index, and says so once", async () => {
    const host = createFixtureHost("serving-failed");
    const h = harness({ host });
    const first = fixtureCommits("serving-failed").main;
    await servedFrom(h, ADDRESS, first);

    const newest = host.push();
    host.fail("getTree");
    await expect
      .poll(async () => (await mountOf(h, ADDRESS)).newest?.status, INDEXED_WITHIN)
      .toBe("failed");
    const body = await mountOf(h, ADDRESS);
    expect(body.commit).toBe(first);
    expect(body.index.status).toBe("ready");
    expect(body.newest).toEqual({
      commit: newest,
      status: "failed",
      errorCode: expect.any(String),
    });

    // The connection names both commits once; every result names them in one clause and no more.
    const client = await h.connect(ADDRESS);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain(
      `(commit ${first.slice(0, 7)}; newest ${newest.slice(0, 7)} failed (`,
    );
    expect(instructions).toContain(
      `The newest commit of this ref, ${newest.slice(0, 7)}, could not be indexed`,
    );
    const browsed = await client.callTool({ name: "browse_repo", arguments: {} });
    const text = (browsed.content as { text?: string }[])
      .map((block) => block.text ?? "")
      .join("\n");
    expect(text).toContain(
      `Source: Acme/multi-skill (commit ${first.slice(0, 7)}; newest ${newest.slice(0, 7)} failed (`,
    );
    expect(text).toContain("skills/");
    await client.close();

    // An address pinned to the newest commit asks for that commit, and gets its state.
    const pinned = await mountOf(h, `${ADDRESS}@${newest}`);
    expect(pinned.commit).toBe(newest);
    expect(pinned.index).toEqual({ status: "failed", errorCode: expect.any(String) });
    expect(pinned.newest).toBeNull();
  });

  it("is served from the last indexed commit while the newest is being indexed, then from the newest", async () => {
    const host = createFixtureHost("serving-indexing");
    const h = harness({ host });
    const first = fixtureCommits("serving-indexing").main;
    await servedFrom(h, SINGLE, first);

    const release = host.holdTrees();
    const newest = host.push();
    const during = await mountOf(h, SINGLE);
    expect(during.commit).toBe(first);
    expect(during.index.status).toBe("ready");
    expect(during.newest).toEqual({ commit: newest, status: "indexing", errorCode: null });
    release();
    await servedFrom(h, SINGLE, newest);
  });
});

describe("a commit whose index is rebuilt under newer reading rules", () => {
  it("is served from its index under the rules before, down to the floor the indexer sets", async () => {
    const host = createFixtureHost("serving-rebuild");
    const h = harness({ host, minServableIndexVersion: INDEX_VERSION - 1 });
    const commit = fixtureCommits("serving-rebuild").main;
    await servedFrom(h, MANIFEST, commit);
    await markIndexVersion(testDatabase.database, commit, INDEX_VERSION - 1);

    const release = host.holdTrees();
    const during = await mountOf(h, MANIFEST);
    expect(during.commit).toBe(commit);
    expect(during.index.status).toBe("ready");
    expect(during.newest).toEqual({ commit, status: "indexing", errorCode: null });
    release();
    await servedFrom(h, MANIFEST, commit);
  });

  it("answers indexing while the index is below that floor", async () => {
    const host = createFixtureHost("serving-floor");
    const h = harness({ host });
    const commit = fixtureCommits("serving-floor").main;
    await servedFrom(h, DOCUMENTS, commit);
    // Below the floor the indexer sets, whatever the current version is above it.
    await markIndexVersion(testDatabase.database, commit, MIN_SERVABLE_INDEX_VERSION - 1);

    const release = host.holdTrees();
    const during = await mountOf(h, DOCUMENTS);
    expect(during.index).toEqual({ status: "indexing" });
    expect(during.newest).toBeNull();
    release();
    await servedFrom(h, DOCUMENTS, commit);
  });
});
