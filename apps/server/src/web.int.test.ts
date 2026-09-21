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

  it("answers a browser on an address with the explorer, and everyone else with MCP", async () => {
    const host = createFixtureHost("web-negotiation");
    const h = createHarness(testDatabase, { web, host });
    const address = `/gh/acme/multi-skill@${fixtureCommits("web-negotiation").main}`;

    const page = await h.request(`${address}?lang=ko`, { headers: BROWSER });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Shell in Korean");
    // Even an address that names nothing gets the page: the page is what explains it.
    expect((await h.request("/gh/acme/no-such-repo", { headers: BROWSER })).status).toBe(200);
    // Serving the page asked the git host nothing and indexed nothing.
    expect(host.calls).toMatchObject({ getRepository: 0, resolveRef: 0, getTree: 0 });

    const ping = await h.request(address, {
      method: "POST",
      headers: MCP,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(ping.status).toBe(200);
    expect(ping.headers.get("content-type")).not.toContain("text/html");
    expect(host.calls.getRepository).toBe(1);

    // A GET that does not ask for HTML is MCP's to answer, as it was without a web build.
    const stream = await h.request(address, { headers: { accept: "text/event-stream" } });
    expect(stream.headers.get("content-type") ?? "").not.toContain("text/html");
    await h.snapshots.idle();
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
