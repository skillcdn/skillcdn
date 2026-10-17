import { fileURLToPath } from "node:url";
import {
  allowEverything,
  type BrowseResult,
  type FileResult,
  type FindResult,
  parseAddress,
  type SkillResult,
} from "@skillcdn/core";
import { createBlobStore } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { INDEX_LIMIT_DEFAULTS, readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, type MountContext, Reader } from "@skillcdn/reader";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MountService } from "./mounts/mount-service.js";
import { createMountReader } from "./mounts/reader.js";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";

// What the command answers from a directory is what a deployment answers from the same commit
// (ADR-0053, ADR-0054): the same reader over an index in memory and over the index the
// database keeps, read from the same fixture repository, answer the same results, up to what
// names where the files are and, for a search, which of two matches comes first.

const FIXTURES = fileURLToPath(new URL("../fixtures/.repositories/", import.meta.url));

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await database?.drop();
});

/** The same results from both sides, for one fixture repository. */
async function both(name: string) {
  const host = createFixtureHost();
  const h = createHarness(database, { host });
  const parsed = parseAddress(`/gh/acme/${name}`);
  if (!parsed.ok) throw new Error("invalid fixture address");
  const mounts = new MountService({
    database: database.database,
    gitHost: h.host,
    clock: { now: () => new Date() },
    entitlements: allowEverything,
    repoTtlMs: 60_000,
    refTtlMs: 60_000,
    staleGraceMs: 60_000,
    isVerified: async () => true,
    imageOf: async () => undefined,
  });
  const mount = await mounts.resolve(parsed.value);
  const stored = createMountReader({
    database: database.database,
    gitHost: h.host,
    snapshots: h.snapshots,
    limits: INDEX_LIMIT_DEFAULTS,
    blobStore: createBlobStore(database.database),
  });
  const read = await readDirectory({
    directory: `${FIXTURES}${name}`,
    limits: INDEX_LIMIT_DEFAULTS,
    repository: { owner: "acme", name },
  });
  const local: MountContext = {
    address: parsed.value,
    commit: mount.commit,
    verified: true,
    limits: {},
    repository: mount.repository,
    description: mount.description,
    sourceUrl: mount.sourceUrl,
    rawUrl: mount.rawUrl,
  };
  const memory = new Reader<MountContext>({
    limits: INDEX_LIMIT_DEFAULTS,
    index: async () => ({
      status: "ready",
      index: createMemoryIndex({ index: read.index, blobs: read.blobs }),
    }),
  });
  return { mount, local, stored, memory };
}

const ready = async <T extends { status: string }>(
  answer: Promise<T>,
): Promise<Extract<T, { status: "ready" }>> => {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await answer;
    if (value.status === "ready") return value as Extract<T, { status: "ready" }>;
    if (Date.now() > deadline) throw new Error(`not ready: ${value.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** Every page of a skill, joined by the reader's own cursor, from either side. */
async function skillOf(reader: Reader<MountContext>, mount: MountContext, path: string) {
  const pages: SkillResult[] = [];
  let cursor: string | undefined;
  for (;;) {
    const answer = await ready(reader.skill(mount, path, 20_000, cursor, true));
    if (answer.lookup.kind !== "found") throw new Error(`skill ${path}: ${answer.lookup.kind}`);
    pages.push(answer.lookup.skill);
    cursor = answer.lookup.skill.nextCursor;
    if (answer.lookup.skill.complete || cursor === undefined) return pages;
  }
}

describe.each(["multi-skill", "with-manifest", "licensed"])("the fixture %s", (name) => {
  it("browses, lists, loads and reads the same from memory as from the database", async () => {
    const { mount, local, stored, memory } = await both(name);
    const browsedStored: BrowseResult = (await ready(stored.browse(mount, {}, 20_000))).result;
    const browsedMemory: BrowseResult = (await ready(memory.browse(local, {}, 0))).result;
    expect(browsedMemory).toEqual(browsedStored);

    const listedStored: FindResult = (await ready(stored.find(mount, { limit: 25 }, 20_000)))
      .result;
    const listedMemory: FindResult = (await ready(memory.find(local, { limit: 25 }, 0))).result;
    expect(listedMemory).toEqual(listedStored);

    const overviewStored = await ready(stored.overview(mount, 200));
    const overviewMemory = await ready(memory.overview(local, 200));
    expect(overviewMemory.overview).toEqual(overviewStored.overview);

    for (const item of listedStored.items) {
      if (item.kind !== "skill" || item.path === undefined) continue;
      const fromStore = await skillOf(stored, mount, item.path);
      const fromMemory = await skillOf(memory, local, item.path);
      expect(fromMemory).toEqual(fromStore);
    }

    const document = listedStored.items.find((item) => item.kind === "document");
    if (document !== undefined) {
      const fileStored = await stored.file(mount, { path: document.path });
      const fileMemory = await memory.file(local, { path: document.path });
      expect(fileMemory).toEqual(fileStored);
      if (fileStored.kind === "found") {
        const page: FileResult = fileStored.file;
        expect(page.content.length).toBeGreaterThan(0);
      }
    }
  });

  it("finds the same results for a search, in an order that agrees where the ranks differ", async () => {
    const { mount, local, stored, memory } = await both(name);
    for (const query of ["release", "skill", "guide notes", "incident review timeline"]) {
      const fromStore = (await ready(stored.find(mount, { query, limit: 25 }, 20_000))).result;
      const fromMemory = (await ready(memory.find(local, { query, limit: 25 }, 0))).result;
      const paths = (result: FindResult) => result.items.map((item) => item.path).sort();
      expect(paths(fromMemory)).toEqual(paths(fromStore));
      expect(fromMemory.items).toEqual(fromStore.items);
    }
  });
});
