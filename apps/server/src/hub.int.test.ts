import type { Client } from "@modelcontextprotocol/client";
import { restSearchSchema } from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

// The search across every pack a deployment serves (ADR-0070): the REST route and the MCP server
// at the root, over the packs the deployment has indexed and the operator has not blocked. The
// tests share one database, so the packs of an earlier test are still there for a later one.

let testDatabase: TestDatabase;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await testDatabase?.drop();
});

/** A harness on a clock the test moves: the packs a search covers are read again after a moment. */
function harness(options: HarnessOptions = {}) {
  let now = Date.parse("2026-02-01T00:00:00Z");
  const h = createHarness(testDatabase, { clock: { now: () => new Date(now) }, ...options });
  const later = (): void => {
    now += 20_000;
  };
  return { ...h, later };
}
const INDEXED_WITHIN = { timeout: 15_000, interval: 50 };

/** Resolves the address and waits until its index is ready. */
async function indexed(h: Pick<Harness, "request">, address: string): Promise<void> {
  await expect
    .poll(async () => {
      const response = await h.request(`/api/v1/mounts${address}`);
      const body = (await response.json()) as { index: { status: string } };
      return body.index.status;
    }, INDEXED_WITHIN)
    .toBe("ready");
}

async function search(h: Pick<Harness, "request">, query: string) {
  const response = await h.request(`/api/v1/search?${query}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return restSearchSchema.parse(await response.json());
}

async function searchText(client: Client, query: string, limit?: number): Promise<string> {
  const result = await client.callTool({
    name: "search_packs",
    arguments: limit === undefined ? { query } : { query, limit },
  });
  expect(result.structuredContent).toBeUndefined();
  return (result.content as { text?: string }[]).map((block) => block.text ?? "").join("\n");
}

describe("the search across every pack", () => {
  it("answers the words of every indexed public pack, each result under the address of its pack", async () => {
    const host = createFixtureHost("hub-rest");
    const h = harness({ host });
    const before = (await search(h, "query=release")).packs;
    await indexed(h, "/gh/acme/multi-skill");
    await indexed(h, "/gh/acme/document-pack");
    // The packs searched are kept for a moment: the two just indexed are seen after it.
    expect((await search(h, "query=release")).packs).toBe(before);
    h.later();

    const found = await search(h, "query=release+notes");
    expect(found.packs).toBe(before + 2);
    expect(found.query).toBe("release notes");
    const addresses = new Set(found.items.map((item) => item.address));
    expect(addresses.has("/gh/acme/multi-skill")).toBe(true);
    expect(addresses.has("/gh/acme/document-pack")).toBe(true);
    const skill = found.items.find(
      (item) => item.item.kind === "skill" && item.address === "/gh/acme/multi-skill",
    );
    expect(skill).toMatchObject({
      repository: "Acme/multi-skill",
      item: { kind: "skill", name: "release-notes", path: "skills/release-notes/SKILL.md" },
    });
    const document = found.items.find(
      (item) => item.item.kind === "document" && item.item.path === "docs/release-notes.md",
    );
    expect(document?.address).toBe("/gh/acme/document-pack");
    expect(document?.item.kind === "document" ? document.item.sections?.length : 0).toBeGreaterThan(
      0,
    );
    // Without a model, the ranking says nothing of meaning.
    expect(found.ranking).toBeUndefined();

    expect((await search(h, "query=release+notes&limit=1")).items).toHaveLength(1);
    for (const bad of [
      "query=",
      "query=%20",
      "limit=3",
      "query=release&limit=0",
      "query=release&limit=99",
    ]) {
      expect((await h.request(`/api/v1/search?${bad}`)).status, bad).toBe(400);
    }
  });

  it("serves the one tool at the root to an MCP client, and leaves a browser's GET to the pages", async () => {
    const host = createFixtureHost("hub-mcp");
    const h = harness({ host });
    await indexed(h, "/gh/acme/multi-skill");
    const client = await h.connect("/");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["search_packs"]);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/\d+ public packs? served at http:\/\//);
    expect(instructions).toContain("search_packs");
    expect(instructions).toContain("/gh/<owner>/<repo>");

    const text = await searchText(client, "release notes");
    expect(text).toContain("/gh/acme/multi-skill");
    expect(text).toContain("skill: release-notes (skills/release-notes/SKILL.md)");
    expect(text).toContain("Connect to a pack at http://");
    expect(await searchText(client, "nothingmatchesthisword")).toContain("No results for");
    await client.close();

    // A plain GET of the root is not an MCP request: without the pages, there is nothing at it.
    const page = await h.request("/", { headers: { accept: "text/html" } });
    expect(page.status).toBe(404);
    expect(await page.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("leaves out a pack the operator blocked, once it reads the packs again", async () => {
    const host = createFixtureHost("hub-blocked");
    const h = harness({ host });
    await indexed(h, "/gh/acme/multi-skill");
    await indexed(h, "/gh/acme/document-pack");
    const before = (await search(h, "query=release")).packs;
    expect(before).toBeGreaterThanOrEqual(2);
    await h.lists.add("blocked", "/gh/acme/document-pack");
    h.later();
    const found = await search(h, "query=release");
    expect(found.packs).toBe(before - 1);
    expect(found.items.some((item) => item.address === "/gh/acme/document-pack")).toBe(false);
    expect(found.items.some((item) => item.address === "/gh/acme/multi-skill")).toBe(true);
    await h.lists.remove("blocked", "/gh/acme/document-pack");
  });

  it("is not there when the operator turns it off", async () => {
    const host = createFixtureHost("hub-off");
    const h = harness({ host, hub: { enabled: false, timeoutMs: 2000, candidates: 50 } });
    expect((await h.request("/api/v1/search?query=release")).status).toBe(404);
    const posted = await h.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(posted.status).toBe(404);
  });
});
