import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ICON_ROUTE,
  restBrowseSchema,
  restErrorSchema,
  restFeaturedSchema,
  restMountSchema,
  restSearchSchema,
} from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

// A deployment serves packs from a directory of its own at `local` addresses (ADR-0071): as a
// repository of a git host is served, by the same routes and tools, with the hash of the tree
// as the commit. The tests share one database and one directory of packs; a test that changes
// a pack has one of its own.

const FIXTURES = fileURLToPath(new URL("../fixtures/.repositories", import.meta.url));
const INDEXED_WITHIN = { timeout: 15_000, interval: 50 };
const HANDBOOK = "/local/acme/handbook";
const NOTES = "/local/acme/notes";

let testDatabase: TestDatabase;
let root: string;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = mkdtempSync(join(tmpdir(), "skillcdn-packs-"));
  cpSync(join(FIXTURES, "document-pack"), join(root, "acme", "handbook"), { recursive: true });
  // A document pack of this test's own, which one test changes.
  mkdirSync(join(root, "acme", "notes", "docs"), { recursive: true });
  writeFileSync(
    join(root, "acme", "notes", "SKILLCDN.md"),
    "---\nname: Notes\ndescription: Notes about kettles, as a pack of documents.\ndocuments:\n  - docs\nlicense: MIT\n---\n",
  );
  writeFileSync(join(root, "acme", "notes", "README.md"), "# Notes\n\nNotes about kettles.\n");
  writeFileSync(join(root, "acme", "notes", "docs", "README.md"), "# The notes\n\n- big.md\n");
  // Over the read limit of the harness: indexed, never read, so that its source is named.
  writeFileSync(
    join(root, "acme", "notes", "docs", "big.md"),
    `# Big\n\n${"word ".repeat(1200)}\n`,
  );
});
afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await testDatabase?.drop();
});

/** A harness on a clock the test moves: a ref is trusted for a minute, and the test lets it pass. */
function harness(options: HarnessOptions = {}) {
  let now = Date.parse("2026-03-01T00:00:00Z");
  const h = createHarness(testDatabase, {
    packsRoot: root,
    clock: { now: () => new Date(now) },
    ...options,
  });
  const later = (): void => {
    now += 90_000;
  };
  return { ...h, later };
}

async function mountOf(h: Pick<Harness, "request">, address: string) {
  const response = await h.request(`/api/v1/mounts${address}`);
  expect(response.status).toBe(200);
  return restMountSchema.parse(await response.json());
}

/** The mount once its index is ready and nothing newer stands beside it. */
async function ready(h: Pick<Harness, "request">, address: string) {
  await expect
    .poll(async () => {
      const body = await mountOf(h, address);
      return body.index.status === "ready" && body.newest === null;
    }, INDEXED_WITHIN)
    .toBe(true);
  return mountOf(h, address);
}

async function errorOf(h: Pick<Harness, "request">, path: string) {
  const response = await h.request(path);
  return { status: response.status, body: restErrorSchema.parse(await response.json()) };
}

describe("a deployment with a directory of packs", () => {
  it("serves a directory as a public, verified pack of the local host, at the hash of its tree", async () => {
    const h = harness();
    const body = await ready(h, HANDBOOK);
    expect(body.address).toBe(HANDBOOK);
    expect(body.repository).toEqual({
      host: "local",
      owner: "acme",
      name: "handbook",
      defaultBranch: "working",
      description: null,
      avatar: "",
      visibility: "public",
    });
    expect(body.verified).toBe(true);
    expect(body.ref).toBeNull();
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    // The same files read by another process are the same commit.
    expect((await ready(harness(), HANDBOOK)).commit).toBe(body.commit);
    // The owner of a directory is a name: there is no picture to serve as the icon.
    expect((await h.request(`${ICON_ROUTE}${HANDBOOK}`)).status).toBe(404);
  });

  it("answers MCP at the address as it answers a repository", async () => {
    const h = harness();
    const body = await ready(h, HANDBOOK);
    const client = await h.connect(HANDBOOK);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("acme/handbook");
    expect(instructions).toContain(`(commit ${body.commit.slice(0, 7)}`);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual(["browse_repo", "load_skill", "read_repo_file", "search_repo"]);
    const found = await client.callTool({ name: "search_repo", arguments: { query: "invoice" } });
    const text = (found.content as { text?: string }[]).map((block) => block.text ?? "").join("\n");
    expect(text).toContain("docs/invoicing.md");
    await client.close();
  });

  it("knows no ref of a working tree, and nothing by another name, in the words of any name that is nothing", async () => {
    const h = harness();
    const ref = await errorOf(h, `/api/v1/mounts${HANDBOOK}@main`);
    expect(ref.status).toBe(404);
    const missing = await errorOf(h, "/api/v1/mounts/local/acme/nothing");
    const unknown = await errorOf(h, "/api/v1/mounts/gh/acme/nothing");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(unknown.body);
    // A name the grammar allows and the directory does not have: a file, or a hidden directory.
    expect((await errorOf(h, "/api/v1/mounts/local/acme/notes.md")).status).toBe(404);
  });

  it("serves no local address without a directory of packs", async () => {
    const h = createHarness(testDatabase);
    const local = await errorOf(h, `/api/v1/mounts${HANDBOOK}`);
    const unknown = await errorOf(h, "/api/v1/mounts/gh/acme/nothing");
    expect(local.status).toBe(404);
    expect(local.body).toEqual(unknown.body);
  });

  it("names the page of the address at the file as the source of what it does not carry", async () => {
    const h = harness();
    await ready(h, NOTES);
    const response = await h.request(`/api/v1/browse${NOTES}?path=docs/big.md`);
    expect(response.status).toBe(200);
    const browse = restBrowseSchema.parse(await response.json());
    if (browse.status !== "ready") throw new Error(`not ready: ${browse.status}`);
    expect(browse.outline?.unavailable).toBe("too_large");
    expect(browse.outline?.sourceUrl).toBe("/local/acme/notes?file=docs%2Fbig.md");
  });

  it("sees a changed file as a new commit once the ref's time is up, and lists what changed", async () => {
    const h = harness();
    const first = await ready(h, NOTES);
    writeFileSync(
      join(root, "acme", "notes", "docs", "kettles.md"),
      "# Kettles\n\nBoil, then pour.\n",
    );
    // Within the minute the ref is trusted, the pack is what it was.
    expect((await mountOf(h, NOTES)).commit).toBe(first.commit);
    h.later();
    // Served from the first commit while the new one is indexed (ADR-0068), then from the new one.
    await expect
      .poll(async () => {
        const body = await mountOf(h, NOTES);
        return (
          body.index.status === "ready" && body.newest === null && body.commit !== first.commit
        );
      }, INDEXED_WITHIN)
      .toBe(true);
    const response = await h.request(`/api/v1/browse${NOTES}?path=docs`);
    const browse = restBrowseSchema.parse(await response.json());
    if (browse.status !== "ready") throw new Error(`not ready: ${browse.status}`);
    expect(browse.entries.map((entry) => entry.path)).toContain("docs/kettles.md");
  });

  it("is featured as any repository is, and found by the search across every pack", async () => {
    const h = harness();
    await ready(h, HANDBOOK);
    await h.lists.add("featured", HANDBOOK);
    const featured = restFeaturedSchema.parse(await (await h.request("/api/v1/featured")).json());
    const card = featured.items.find((item) => item.address === HANDBOOK);
    expect(card?.repository).toMatchObject({ host: "local", owner: "acme", avatar: "" });
    expect(card?.verified).toBe(true);

    h.later();
    const response = await h.request("/api/v1/search?query=invoicing");
    expect(response.status).toBe(200);
    const search = restSearchSchema.parse(await response.json());
    expect(search.items.some((item) => item.address.startsWith(HANDBOOK))).toBe(true);
  });
});
