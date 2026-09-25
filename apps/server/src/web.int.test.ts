import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWebBundle, type WebBundle } from "./http/web.js";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";
import { createWebBuild, type WebBuildFixture } from "./testing/web-build.js";

const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const MCP = { accept: "application/json, text/event-stream", "content-type": "application/json" };

let testDatabase: TestDatabase;
let build: WebBuildFixture;
let web: WebBundle;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  build = createWebBuild();
  web = await loadWebBundle(build.root, { publicUrl: "https://skills.example" });
});

afterAll(async () => {
  build?.remove();
  await testDatabase?.drop();
});

/** What the fake render module was given, read back from the page. */
async function inputOf(page: Response): Promise<Record<string, unknown>> {
  const html = await page.text();
  const match = /<pre id="input">(.*?)<\/pre>/s.exec(html);
  if (match?.[1] === undefined) {
    throw new Error(`not a rendered address page: ${html.slice(0, 200)}`);
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("a server with a web build", () => {
  it("serves its pages, in the language the URL asks for", async () => {
    const h = createHarness(testDatabase, { web });
    const front = await h.request("/", { headers: BROWSER });
    expect(front.status).toBe(200);
    expect(front.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(front.headers.get("x-request-id")).toBeTruthy();
    expect(await front.text()).toContain("Front page");
    expect(await (await h.request("/explore?lang=ko")).text()).toContain("Explore in Korean");
    expect((await h.request("/assets/index-abc123.js")).headers.get("cache-control")).toContain(
      "immutable",
    );
    expect((await h.request("/sitemap.xml")).status).toBe(200);
    expect((await h.request("/robots.txt")).status).toBe(200);
    expect((await h.request("/", { method: "HEAD" })).status).toBe(200);
  });

  it("answers a browser on an address with the page of what it serves, and everyone else with MCP", async () => {
    const host = createFixtureHost("web-negotiation");
    const h = createHarness(testDatabase, { web, host });
    const commit = fixtureCommits("web-negotiation").main;
    const address = `/gh/acme/multi-skill@${commit}/skills`;

    // The first look starts indexing, like the API does, and says so.
    const first = await h.request(`${address}?lang=ko`, { headers: BROWSER });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(first.headers.get("vary")).toBe("accept");
    const started = await inputOf(first);
    expect(started).toMatchObject({
      language: "ko",
      origin: "https://skills.example",
      pathname: address,
      search: "?lang=ko",
      data: { mount: { ready: { address, index: { status: "indexing" } } } },
    });
    expect(host.calls.getRepository).toBe(1);
    await h.snapshots.idle();

    // With the index there, the page carries what the address serves, and the skill it asks for.
    const done = await inputOf(
      await h.request(`${address}?skill=skills/release-notes/SKILL.md`, { headers: BROWSER }),
    );
    expect(done).toMatchObject({
      language: "en",
      data: {
        mount: { ready: { index: { status: "ready", skillCount: 2 } } },
        skill: {
          ready: {
            status: "ready",
            skill: { name: "release-notes", path: "skills/release-notes/SKILL.md" },
          },
        },
      },
    });
    // Without a language in the URL, the page is in the one the request asks for (ADR-0021).
    const asked = await h.request(address, {
      headers: { ...BROWSER, "accept-language": "ko-KR,ko;q=0.9" },
    });
    expect(asked.headers.get("vary")).toBe("accept, accept-language");
    expect(await inputOf(asked)).toMatchObject({ language: "ko", search: "" });
    const missingSkill = await inputOf(
      await h.request(`${address}?skill=skills/no-such-skill/SKILL.md`, { headers: BROWSER }),
    );
    expect(missingSkill.data).toMatchObject({
      skill: { error: { status: 404, code: "skill.not_found" } },
    });

    const ping = await h.request(address, {
      method: "POST",
      headers: MCP,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(ping.status).toBe(200);
    expect(ping.headers.get("content-type")).not.toContain("text/html");

    // A GET that does not ask for HTML is MCP's to answer, as it was without a web build.
    const stream = await h.request(address, { headers: { accept: "text/event-stream" } });
    expect(stream.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("renders invalid folder scopes and oversized page queries as 400 pages", async () => {
    const host = createFixtureHost("web-invalid-scope");
    const h = createHarness(testDatabase, { web, host });
    const address = `/gh/acme/multi-skill@${fixtureCommits("web-invalid-scope").main}/skills/release-notes`;
    const client = await h.connect(address);
    await client.callTool({ name: "browse_repo", arguments: {} });
    await client.close();
    const browse = await inputOf(await h.request(address, { headers: BROWSER }));
    expect(browse.data).toMatchObject({
      browse: { ready: { status: "ready", path: "skills/release-notes" } },
    });
    const search = await inputOf(await h.request(`${address}?q=style`, { headers: BROWSER }));
    expect(search.data).toMatchObject({
      find: {
        ready: {
          status: "ready",
          items: [
            expect.objectContaining({ kind: "skill", path: "skills/release-notes/SKILL.md" }),
          ],
        },
      },
    });
    const invalidParameters: Record<string, string>[] = [
      { path: "../outside" },
      { path: "/etc/passwd" },
      { path: "docs" },
      { path: "docs", q: "guide" },
      { q: "x".repeat(501) },
      { query: "x".repeat(501) },
      { path: "x".repeat(1025) },
      { skill: "x".repeat(1025) },
      { file: "x".repeat(1025) },
    ];
    for (const parameters of invalidParameters) {
      const response = await h.request(`${address}?${new URLSearchParams(parameters)}`, {
        headers: BROWSER,
      });
      expect(response.status, JSON.stringify(parameters).slice(0, 100)).toBe(400);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect((await inputOf(response)).data).toMatchObject({
        mount: { error: { status: 400, code: "request.invalid" } },
      });
    }
    expect(h.logs.some((line) => line.msg === "unhandled request error")).toBe(false);
  });

  it("gives a browser the page, with the status, for an address that is nothing", async () => {
    const h = createHarness(testDatabase, { web });
    // A repository that does not exist, and an address that is not one: the page explains both.
    const missing = await h.request("/gh/acme/no-such-repo", { headers: BROWSER });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await inputOf(missing)).data).toEqual({
      mount: { error: { status: 404, code: "mount.repo_not_found", message: expect.any(String) } },
    });
    const bad = await h.request("/gh/acme", { headers: BROWSER });
    expect(bad.status).toBe(404);
    expect((await inputOf(bad)).data).toEqual({});
  });

  it("lists the featured and the vouched-for repositories in the sitemap, and nothing else", async () => {
    const h = createHarness(testDatabase, { web });
    await h.lists.add("featured", "/gh/acme/multi-skill/skills");
    await h.lists.add("verified", "/gh/Acme/single-skill");
    await h.lists.add("featured", "/gh/acme/single-skill@main");
    // A blocked repository is never listed, whatever else says so.
    await h.lists.add("featured", "/gh/acme/private-repo");
    await h.lists.add("blocked", "/gh/acme/private-repo");
    // The sitemap comes from the lists alone; nothing has to be indexed or visited first.
    const xml = await (await h.request("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://skills.example/gh/acme/multi-skill/skills</loc>");
    expect(xml).toContain("<loc>https://skills.example/gh/acme/multi-skill/skills?lang=ko</loc>");
    expect(xml).toContain("<loc>https://skills.example/gh/acme/single-skill</loc>");
    expect(xml).toContain("<loc>https://skills.example/gh/acme/single-skill@main</loc>");
    expect(xml).not.toContain("private-repo");
    expect(xml).not.toContain("<loc>https://skills.example/gh/acme/multi-skill</loc>");
    expect((await h.request("/robots.txt")).status).toBe(200);
  });

  it("answers what is nothing with a page for browsers and with JSON for everyone else", async () => {
    const h = createHarness(testDatabase, { web });
    const page = await h.request("/no/such/page?lang=ko", { headers: BROWSER });
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("Not found in Korean");

    const json = await h.request("/no/such/page");
    expect(json.status).toBe(404);
    expect(await json.json()).toEqual({
      error: { code: "not_found", message: "There is nothing at this path." },
    });
    expect((await h.request("/routes.json")).status).toBe(404);
    expect((await h.request("/index.html")).status).toBe(404);
    expect((await h.request("/render/entry-server.js")).status).toBe(404);
  });

  it("leaves the API and the probes as they are", async () => {
    const h = createHarness(testDatabase, { web });
    expect(await (await h.request("/healthz", { headers: BROWSER })).json()).toEqual({
      status: "ok",
    });
    const missing = await h.request("/api/v1/mounts/gh/acme/no-such-repo", { headers: BROWSER });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    expect((await h.request("/api/v1/nothing", { headers: BROWSER })).status).toBe(404);
  });
});

describe("a server with a web build that cannot render", () => {
  it("gives browsers the frame on an address, which asks the API for the rest", async () => {
    const plain = createWebBuild(undefined, { render: false });
    const bundle = await loadWebBundle(plain.root, { publicUrl: "https://skills.example" });
    const host = createFixtureHost("web-shell");
    const h = createHarness(testDatabase, { web: bundle, host });
    const page = await h.request("/gh/acme/multi-skill?lang=ko", { headers: BROWSER });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Shell in Korean");
    expect((await h.request("/gh/acme/no-such-repo", { headers: BROWSER })).status).toBe(404);
    await h.snapshots.idle();
    plain.remove();
  });
});

describe("a server without a web build", () => {
  it("has no pages, and addresses are MCP only", async () => {
    const h = createHarness(testDatabase);
    const front = await h.request("/", { headers: BROWSER });
    expect(front.status).toBe(404);
    expect(front.headers.get("content-type")).toContain("application/json");
    const address = await h.request("/gh/acme/no-such-repo", { headers: BROWSER });
    expect(address.status).toBe(404);
    expect(await address.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });
  });
});
