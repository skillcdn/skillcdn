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
import { loadWebBundle, type WebBundle } from "./http/web.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";
import { createWebBuild, type WebBuildFixture } from "./testing/web-build.js";

// A deployment serves packs from a directory of its own at `local` addresses (ADR-0071): as a
// repository of a git host is served, by the same routes and tools, with the hash of the tree
// as the commit. The tests share one database and one directory of packs; a test that changes
// a pack has one of its own.

const FIXTURES = fileURLToPath(new URL("../fixtures/.repositories", import.meta.url));
const INDEXED_WITHIN = { timeout: 15_000, interval: 50 };
const HANDBOOK = "/local/acme/handbook";
const NOTES = "/local/acme/notes";
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let testDatabase: TestDatabase;
let root: string;
let build: WebBuildFixture;
let web: WebBundle;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  build = createWebBuild();
  web = await loadWebBundle(build.root, { publicUrl: "https://skills.example" });
  root = mkdtempSync(join(tmpdir(), "skillcdn-packs-"));
  cpSync(join(FIXTURES, "document-pack"), join(root, "acme", "handbook"), { recursive: true });
  // A document pack of this test's own, which one test changes.
  mkdirSync(join(root, "acme", "notes", "docs"), { recursive: true });
  writeFileSync(
    join(root, "acme", "notes", "SKILLCDN.md"),
    "---\nname: Notes\ndescription: Notes about kettles, as a pack of documents.\ndocuments:\n  - docs\nlicense: MIT\n---\n",
  );
  writeFileSync(join(root, "acme", "notes", "README.md"), "# Notes\n\nNotes about kettles.\n");
  writeFileSync(
    join(root, "acme", "notes", "docs", "README.md"),
    "# The notes\n\n- big.md\n- kettle.md\n",
  );
  // A chapter with its picture and its original beside it (ADR-0076).
  mkdirSync(join(root, "acme", "notes", "docs", "images"), { recursive: true });
  mkdirSync(join(root, "acme", "notes", "docs", "sources"), { recursive: true });
  writeFileSync(
    join(root, "acme", "notes", "docs", "kettle.md"),
    "---\ntitle: The kettle\nsource: sources/kettle.pdf\n---\n# The kettle\n\n![A kettle on a stove](images/kettle.png)\n\nIt boils.\n",
  );
  writeFileSync(join(root, "acme", "notes", "docs", "images", "kettle.png"), PNG);
  writeFileSync(join(root, "acme", "notes", "docs", "sources", "kettle.pdf"), "%PDF-1.7 pretend");
  // Over the read limit of the harness: indexed, never read, so that its source is named.
  writeFileSync(
    join(root, "acme", "notes", "docs", "big.md"),
    `# Big\n\n${"word ".repeat(1200)}\n`,
  );
});
afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  build?.remove();
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

  it("renders the page of the address for a browser with what the address serves", async () => {
    const h = harness({ web });
    const body = await ready(h, HANDBOOK);
    const page = await h.request(HANDBOOK, { headers: BROWSER });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const input = /<pre id="input">(.*?)<\/pre>/s.exec(await page.text())?.[1];
    expect(JSON.parse(input ?? "{}")).toMatchObject({
      pathname: HANDBOOK,
      data: {
        mount: {
          ready: { address: HANDBOOK, commit: body.commit, repository: { host: "local" } },
        },
      },
    });
    // The owner of a directory has no page (ADR-0071): one segment is an address short of one.
    expect((await h.request("/local/acme", { headers: BROWSER })).status).toBe(404);
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

  it("names its own route as the source of what it does not carry, and sends the bytes from there as an attachment (ADR-0077)", async () => {
    const h = harness();
    await ready(h, NOTES);
    const response = await h.request(`/api/v1/browse${NOTES}?path=docs/big.md`);
    expect(response.status).toBe(200);
    const browse = restBrowseSchema.parse(await response.json());
    if (browse.status !== "ready") throw new Error(`not ready: ${browse.status}`);
    expect(browse.outline?.unavailable).toBe("too_large");
    expect(browse.outline?.sourceUrl).toBe("/api/v1/raw/local/acme/notes?path=docs%2Fbig.md");
    // The file over the read limit, whole, from the disk, with no size limit of the route's own.
    const big = await h.request("/api/v1/raw/local/acme/notes?path=docs%2Fbig.md");
    expect(big.status).toBe(200);
    expect(big.headers.get("content-type")).toBe("application/octet-stream");
    expect(big.headers.get("content-disposition")).toBe(
      `attachment; filename="big.md"; filename*=UTF-8''big.md`,
    );
    expect(big.headers.get("x-content-type-options")).toBe("nosniff");
    expect(big.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(big.headers.get("cache-control")).toBe("no-store");
    expect((await big.text()).startsWith("# Big\n")).toBe(true);
    // A picture: a read names the route, the outline of the chapter names the picture.
    const refused = await h.request(`/api/v1/files${NOTES}?path=docs%2Fimages%2Fkettle.png`);
    expect(refused.status).toBe(415);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "file.not_text",
        sourceUrl: "/api/v1/raw/local/acme/notes?path=docs%2Fimages%2Fkettle.png",
      },
    });
    const picture = await h.request("/api/v1/raw/local/acme/notes?path=docs%2Fimages%2Fkettle.png");
    expect(picture.status).toBe(200);
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
    const outlined = restBrowseSchema.parse(
      await (await h.request(`/api/v1/browse${NOTES}?path=docs/kettle.md`)).json(),
    );
    if (outlined.status !== "ready") throw new Error(`not ready: ${outlined.status}`);
    expect(outlined.outline?.images).toEqual([
      { path: "docs/images/kettle.png", alt: "A kettle on a stove" },
    ]);
    expect(outlined.outline?.sources).toEqual([
      {
        text: "sources/kettle.pdf",
        path: "docs/sources/kettle.pdf",
        url: "/api/v1/raw/local/acme/notes?path=docs%2Fsources%2Fkettle.pdf",
      },
    ]);
    // Nothing outside the index is sent, and nothing of another name.
    expect((await h.request("/api/v1/raw/local/acme/notes?path=README.md")).status).toBe(200);
    expect((await h.request("/api/v1/raw/local/acme/notes?path=nothing.png")).status).toBe(404);
    expect((await h.request("/api/v1/raw/local/acme/nothing?path=README.md")).status).toBe(404);
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
