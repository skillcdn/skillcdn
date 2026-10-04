import { restErrorSchema, restOwnerSchema } from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createFixtureLogin } from "./testing/fixture-login.js";
import { createHarness } from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

const OWNER = "/api/v1/owners/gh/acme";

// The tests share one database and run in order: nothing is indexed until one of them asks.
describe("the page of an account", () => {
  it("says who the account is and lists its public repositories as the host does, without indexing any", async () => {
    const host = createFixtureHost("owners");
    const h = createHarness(testDatabase, { host });
    const response = await h.request("/api/v1/owners/gh/Acme");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const first = restOwnerSchema.parse(await response.json());
    expect(first.owner).toEqual({
      host: "gh",
      login: "Acme",
      name: "Acme Inc.",
      kind: "organization",
      avatar: "https://avatars.githubusercontent.com/u/42?s=320&v=4",
      bio: "Skills for everything Acme makes.",
      url: "https://github.com/Acme",
      publicRepositories: 5,
    });
    expect(first.indexed).toEqual([]);
    expect(first.repositories).toEqual([
      {
        address: "/gh/acme/hostile",
        name: "hostile",
        description: null,
        fork: false,
        archived: true,
        stars: 7,
        pushedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        address: "/gh/acme/licensed",
        name: "licensed",
        description: "Skills under different licenses.",
        fork: false,
        archived: false,
        stars: 8,
        pushedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    expect(first.nextPage).toBe(2);

    const last = restOwnerSchema.parse(await (await h.request(`${OWNER}?page=3`)).json());
    expect(last.repositories.map((repository) => repository.name)).toEqual(["with-manifest"]);
    expect(last.nextPage).toBeNull();

    // The listing came from the host's own list: no repository was resolved, none indexed.
    expect(host.asked).toEqual([]);
    expect(host.calls.getTree).toBe(0);
    // Every visitor is told the same, so the host is asked once for all of them.
    await h.request(OWNER);
    await h.request(OWNER);
    expect(host.calls.getProfile).toBe(1);
    expect(host.calls.listPublicRepositories).toBe(2);
  });

  it("leads with what is indexed and holds skills, and lists it once", async () => {
    const host = createFixtureHost("owners");
    const h = createHarness(testDatabase, { host });
    // Somebody opens two repositories; that is what indexes them, and only them.
    for (const repo of ["multi-skill", "with-manifest"]) {
      expect((await h.request(`/api/v1/mounts/gh/acme/${repo}`)).status).toBe(200);
    }
    await h.snapshots.idle();

    const pages = [];
    for (const page of [1, 2, 3]) {
      pages.push(restOwnerSchema.parse(await (await h.request(`${OWNER}?page=${page}`)).json()));
    }
    const [first] = pages;
    expect(first?.indexed.map((card) => card.address).sort()).toEqual([
      "/gh/acme/multi-skill",
      "/gh/acme/with-manifest",
    ]);
    const multi = first?.indexed.find((card) => card.address === "/gh/acme/multi-skill");
    expect(multi).toMatchObject({
      repository: {
        owner: "Acme",
        name: "multi-skill",
        description: "Two skills and the documents next to them.",
        avatar: "https://avatars.githubusercontent.com/u/42?s=160&v=4",
        visibility: "public",
      },
      manifest: null,
      verified: false,
      status: "ready",
      skillCount: 2,
      skills: ["incident-review", "release-notes"],
    });
    // A repository with a manifest goes by the name and the description it gives itself.
    const named = first?.indexed.find((card) => card.address === "/gh/acme/with-manifest");
    expect(named?.manifest).toMatchObject({ description: expect.any(String) });
    // What leads the page is not repeated in the host's list, on any page of it.
    const listed = pages.flatMap((page) => page.repositories.map((repository) => repository.name));
    expect(listed.sort()).toEqual(["hostile", "licensed", "single-skill"]);
    // Only the first page leads with it.
    expect(pages[1]?.indexed).toEqual([]);
  });

  it("shows nothing that is private or that the operator does not serve", async () => {
    const host = createFixtureHost("owners");
    const login = createFixtureLogin();
    const h = createHarness(testDatabase, { host, login });
    const cookie = await h.signIn("alice");
    expect(
      (await h.request("/api/v1/mounts/gh/acme/secret-skills", { headers: { cookie } })).status,
    ).toBe(200);
    await h.snapshots.idle();
    await h.lists.add("blocked", "/gh/acme/multi-skill");
    await h.lists.add("blocked", "/gh/acme/licensed");

    // Asked by the very person who can see the private repository: the page is what everyone sees.
    const page = restOwnerSchema.parse(
      await (await h.request(OWNER, { headers: { cookie } })).json(),
    );
    const everything = JSON.stringify(page);
    expect(everything).not.toContain("secret-skills");
    expect(everything).not.toContain("multi-skill");
    expect(everything).not.toContain("licensed");
    expect(page.indexed.map((card) => card.address)).toEqual(["/gh/acme/with-manifest"]);

    await h.lists.remove("blocked", "/gh/acme/multi-skill");
    await h.lists.remove("blocked", "/gh/acme/licensed");
    await h.lists.add("verified", "/gh/acme/multi-skill");
    const vouched = restOwnerSchema.parse(await (await h.request(OWNER)).json());
    expect(vouched.indexed.find((card) => card.address === "/gh/acme/multi-skill")?.verified).toBe(
      true,
    );
    await h.lists.remove("verified", "/gh/acme/multi-skill");
  });

  it("answers what is not an account, and a host that cannot be asked", async () => {
    const h = createHarness(testDatabase);
    for (const [path, status, code] of [
      ["/api/v1/owners/gh/nobody", 404, "owner.not_found"],
      ["/api/v1/owners/gh/acme/skills", 400, "owner.invalid"],
      ["/api/v1/owners/gh/-acme", 400, "owner.invalid"],
      ["/api/v1/owners/gl/acme", 400, "owner.invalid"],
      ["/api/v1/owners/gh/acme?page=0", 400, "request.invalid"],
      ["/api/v1/owners/gh/acme?page=two", 400, "request.invalid"],
    ] as const) {
      const response = await h.request(path);
      expect(response.status, path).toBe(status);
      expect(restErrorSchema.parse(await response.json()).error.code, path).toBe(code);
    }
    // Past the end of the host's list there is simply nothing more.
    const beyond = restOwnerSchema.parse(await (await h.request(`${OWNER}?page=9`)).json());
    expect(beyond.repositories).toEqual([]);
    expect(beyond.nextPage).toBeNull();
  });

  it("stops showing a repository that is no longer public, however the index remembers it", async () => {
    const host = createFixtureHost("owners");
    // Nothing the host said is believed for longer than it takes to ask again.
    const h = createHarness(testDatabase, { host, ttlMs: 0 });
    expect((await h.request("/api/v1/mounts/gh/acme/single-skill")).status).toBe(200);
    await h.snapshots.idle();
    const pageOf = async (page: number) =>
      restOwnerSchema.parse(await (await h.request(`${OWNER}?page=${page}`)).json());
    expect((await pageOf(1)).indexed.map((card) => card.address)).toContain(
      "/gh/acme/single-skill",
    );

    // Its owner makes it private. Nobody has asked for its address since, so the index still
    // has it as it was: public, with its skills.
    host.hide("single-skill");
    const pages = [await pageOf(1), await pageOf(2), await pageOf(3)];
    expect(JSON.stringify(pages)).not.toContain("single-skill");
    // The other indexed repositories are still there, and still lead the first page only.
    expect(pages[0]?.indexed.map((card) => card.address)).toContain("/gh/acme/multi-skill");

    // A host that cannot say whether a repository is public is not a yes either.
    const unreachable = createFixtureHost("owners");
    const cautious = createHarness(testDatabase, { host: unreachable, ttlMs: 0 });
    unreachable.fail("getRepository");
    const guarded = restOwnerSchema.parse(await (await cautious.request(OWNER)).json());
    expect(guarded.indexed).toEqual([]);
  });
});
