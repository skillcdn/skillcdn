import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";

// The admin API (ADR-0026): the operator's lists and the takedown, behind one token.

let testDatabase: TestDatabase;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await testDatabase?.drop();
});

const TOKEN = "an-admin-token-that-is-long-enough-to-pass";
const authorized = { authorization: `Bearer ${TOKEN}` };

describe("the admin API", () => {
  it("does not exist without a token, and refuses every other token with one", async () => {
    const without = createHarness(testDatabase);
    expect((await without.request("/admin/v1/repositories")).status).toBe(404);
    expect((await without.request("/admin/v1/repositories", { headers: authorized })).status).toBe(
      404,
    );

    const h = createHarness(testDatabase, { adminToken: TOKEN });
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: TOKEN }]) {
      const refused = await h.request("/admin/v1/repositories", { headers });
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toContain("Bearer");
      expect(await refused.json()).toMatchObject({ error: { code: "admin.unauthorized" } });
    }
    const allowed = await h.request("/admin/v1/repositories", { headers: authorized });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
  });

  it("adds, lists and removes entries, and writes them as addresses", async () => {
    const h = createHarness(testDatabase, { adminToken: TOKEN });
    const put = (kind: string, address: string) =>
      h.request(`/admin/v1/repositories/${kind}${address}`, { method: "PUT", headers: authorized });
    expect(await (await put("verified", "/gh/Acme/Single-Skill")).json()).toEqual({
      kind: "verified",
      address: "/gh/acme/single-skill",
    });
    expect(await (await put("featured", "/gh/acme/multi-skill@main/skills")).json()).toEqual({
      kind: "featured",
      address: "/gh/acme/multi-skill@main/skills",
    });
    expect((await put("verified", "/gh/Acme/Single-Skill")).status).toBe(200);
    // A vouched-for or blocked repository is a repository, not a ref or a path.
    const refused = await put("blocked", "/gh/acme/multi-skill@main");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "operator.invalid_address" } });
    expect((await put("blocked", "/not an address")).status).toBe(400);
    expect((await put("banned", "/gh/acme/multi-skill")).status).toBe(404);

    const listed = await (
      await h.request("/admin/v1/repositories", { headers: authorized })
    ).json();
    expect(listed).toMatchObject({
      items: [
        { kind: "verified", address: "/gh/acme/single-skill" },
        { kind: "featured", address: "/gh/acme/multi-skill@main/skills" },
      ],
    });
    const featured = await (
      await h.request("/admin/v1/repositories?kind=featured", { headers: authorized })
    ).json();
    expect(featured).toMatchObject({ items: [{ kind: "featured" }] });
    expect(
      (await h.request("/admin/v1/repositories?kind=other", { headers: authorized })).status,
    ).toBe(400);

    const removed = await h.request("/admin/v1/repositories/verified/gh/acme/single-skill", {
      method: "DELETE",
      headers: authorized,
    });
    expect(await removed.json()).toEqual({
      kind: "verified",
      address: "/gh/acme/single-skill",
      removed: true,
    });
    expect(
      (
        await h.request("/admin/v1/repositories/verified/gh/acme/single-skill", {
          method: "DELETE",
          headers: authorized,
        })
      ).status,
    ).toBe(404);
    expect(await h.lists.all("verified")).toEqual([]);
  });

  it("purges what was indexed for a repository, and the bodies nothing references", async () => {
    const host = createFixtureHost("admin-purge");
    const h = createHarness(testDatabase, { adminToken: TOKEN, host });
    const commit = fixtureCommits("admin-purge").main;
    const client = await h.connect(`/gh/acme/single-skill@${commit}`);
    await client.close();
    await h.snapshots.idle();
    expect((await h.request(`/api/v1/mounts/gh/acme/single-skill@${commit}`)).status).toBe(200);

    const unknown = await h.request("/admin/v1/purge/gh/acme/never-seen", {
      method: "POST",
      headers: authorized,
    });
    expect(unknown.status).toBe(404);
    const purged = await h.request("/admin/v1/purge/gh/acme/single-skill", {
      method: "POST",
      headers: authorized,
    });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toMatchObject({ snapshots: 1 });
    // The next request indexes the repository again, unless it is blocked as well.
    await h.lists.add("blocked", "/gh/acme/single-skill");
    expect((await h.request(`/api/v1/mounts/gh/acme/single-skill@${commit}`)).status).toBe(404);
    expect(host.calls.getTree).toBe(1);
  });
});
