import {
  AUTH_ROUTES,
  allowEverything,
  parseAddress,
  restMeSchema,
  restMountSchema,
  restMyRepositoriesSchema,
} from "@skillcdn/core";
import { deleteStaleMissingRepos, getUserCredentials } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MountService, type RepoPermissions } from "./mounts/mount-service.js";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createFixtureLogin, FIXTURE_INSTALL_URL } from "./testing/fixture-login.js";
import {
  createHarness,
  type Harness,
  type HarnessOptions,
  SIGN_IN_URL,
} from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

/** A clock a test can move forward. */
function movableClock() {
  let offset = 0;
  return {
    now: () => new Date(Date.now() + offset),
    advance(milliseconds: number) {
      offset += milliseconds;
    },
  };
}

function harness(options: HarnessOptions = {}) {
  const login = options.login ?? createFixtureLogin();
  return { login, ...createHarness(testDatabase, { login, ...options }) };
}

const SECRET = "/api/v1/mounts/gh/acme/secret-skills";

describe("signing in", () => {
  it("sends the browser to the git host with a state and a challenge, and remembers both", async () => {
    const { request } = harness();
    const begun = await request(`${AUTH_ROUTES.login}?return_to=/explore`);
    expect(begun.status).toBe(302);
    expect(begun.headers.get("cache-control")).toBe("no-store");
    const location = new URL(begun.headers.get("location") ?? "");
    expect(location.origin).toBe("https://git.test");
    expect(location.searchParams.get("redirect_uri")).toBe(`${SIGN_IN_URL}${AUTH_ROUTES.callback}`);
    expect(location.searchParams.get("state")).toMatch(/^[\w-]{20,}$/);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    const [cookie] = begun.headers.getSetCookie();
    // Bound to this very host, so that nobody else can have put it in the browser.
    expect(cookie).toMatch(/^__Host-skillcdn_login=v1\./);
    expect(cookie).toMatch(/; Path=\/;/);
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Max-Age=600"]) {
      expect(cookie).toContain(attribute);
    }
    // What the browser carries is sealed: neither the state nor the verifier can be read off it.
    expect(cookie).not.toContain(location.searchParams.get("state"));
  });

  it("comes back signed in, to the page it left for, with a session only the server reads", async () => {
    const { request, login } = harness();
    const begun = await request(
      `${AUTH_ROUTES.login}?return_to=${encodeURIComponent("/gh/acme/secret-skills?lang=ko")}`,
    );
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const pending = begun.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const done = await request(
      `${AUTH_ROUTES.callback}?code=${login.codeFor("alice", state)}&state=${state}`,
      { headers: { cookie: pending } },
    );
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/gh/acme/secret-skills?lang=ko");
    const cookies = done.headers.getSetCookie();
    // The attempt is forgotten and the session begins.
    expect(cookies.some((cookie) => /^__Host-skillcdn_login=; .*Max-Age=0/.test(cookie))).toBe(
      true,
    );
    const session = cookies.find((cookie) => cookie.startsWith("__Host-skillcdn_session="));
    for (const attribute of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) {
      expect(session).toContain(attribute);
    }

    const me = await request("/api/v1/me", {
      headers: { cookie: session?.split(";")[0] ?? "" },
    });
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect(restMeSchema.parse(await me.json())).toEqual({
      user: {
        host: "gh",
        login: "Alice",
        name: "Alice Example",
        avatar: "https://avatars.githubusercontent.com/u/1001?s=160&v=4",
      },
    });
    expect(restMeSchema.parse(await (await request("/api/v1/me")).json())).toEqual({ user: null });
  });

  it("keeps the git host's credential encrypted, and out of everything it answers", async () => {
    const h = harness();
    const cookie = await h.signIn("alice");
    const me = await h.request("/api/v1/me", { headers: { cookie } });
    expect(JSON.stringify(await me.json())).not.toContain("ghu_");
    expect(JSON.stringify(h.logs)).not.toContain("ghu_");
    const users = await h.auth?.sessions.resolve(cookie);
    const stored = await getUserCredentials(testDatabase.database, users?.id ?? "");
    expect(stored?.accessToken).toMatch(/^v1\./);
    expect(stored?.accessToken).not.toContain("ghu_");
  });

  it.each([
    ["//evil.test/path", "/"],
    ["https://evil.test/", "/"],
    ["/\\evil.test", "/"],
    ["javascript:alert(1)", "/"],
    ["explore", "/"],
    ["/account/apps?x=1#frag", "/account/apps?x=1"],
  ])("only comes back to a page of its own: %s", async (returnTo, expected) => {
    const { request, login } = harness();
    const begun = await request(`${AUTH_ROUTES.login}?return_to=${encodeURIComponent(returnTo)}`);
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const done = await request(
      `${AUTH_ROUTES.callback}?code=${login.codeFor("alice", state)}&state=${state}`,
      { headers: { cookie: begun.headers.getSetCookie()[0]?.split(";")[0] ?? "" } },
    );
    expect(done.headers.get("location")).toBe(expected);
  });

  it("does not finish a sign-in that this browser did not start", async () => {
    const { request, login } = harness();
    const begun = await request(`${AUTH_ROUTES.login}?return_to=/gh/acme/secret-skills`);
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cookie = begun.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const code = login.codeFor("alice", state);
    // What did not complete goes back to the page the attempt was for, which says why over
    // itself and offers to try again: the front page, once the browser no longer carries which.
    const kept = "/gh/acme/secret-skills?sign_in=";

    const noCookie = await request(`${AUTH_ROUTES.callback}?code=${code}&state=${state}`);
    expect(noCookie.headers.get("location")).toBe("/?sign_in=expired");
    const otherState = await request(`${AUTH_ROUTES.callback}?code=${code}&state=someone-elses`, {
      headers: { cookie },
    });
    expect(otherState.headers.get("location")).toBe(`${kept}failed`);
    const denied = await request(`${AUTH_ROUTES.callback}?error=access_denied&state=${state}`, {
      headers: { cookie },
    });
    expect(denied.headers.get("location")).toBe(`${kept}denied`);
    const badCode = await request(`${AUTH_ROUTES.callback}?code=not-a-code&state=${state}`, {
      headers: { cookie },
    });
    expect(badCode.headers.get("location")).toBe(`${kept}failed`);
    // The same sealed value under the name without the prefix, as a neighbouring host could
    // set it for this one: that is not the cookie this server reads.
    const planted = await request(
      `${AUTH_ROUTES.callback}?code=${login.codeFor("alice", state)}&state=${state}`,
      { headers: { cookie: cookie.replace(/^__Host-/, "") } },
    );
    expect(cookie).toMatch(/^__Host-/);
    expect(planted.headers.get("location")).toBe("/?sign_in=expired");
    for (const response of [noCookie, otherState, denied, badCode, planted]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(
        response.headers.getSetCookie().some((value) => value.includes("skillcdn_session")),
      ).toBe(false);
    }
  });

  it("begins only for a browser that came from its own pages, and offers it to everyone else on the page it was for", async () => {
    const { request } = harness();
    const begin = (query: string, site?: string) =>
      request(
        `${AUTH_ROUTES.login}${query}`,
        site === undefined ? {} : { headers: { "sec-fetch-site": site } },
      );
    // A link on another site, a page of a neighbouring host, an address typed or a bookmark:
    // none of them is a person pressing the button, so none of them leaves for the git host.
    for (const site of ["cross-site", "same-site", "none"]) {
      const shown = await begin("?return_to=%2Fgh%2Facme%2Fsecret-skills%3Flang%3Dko", site);
      expect(shown.status, site).toBe(302);
      // The page they were on the way to, asked to open the sign-in dialog over itself.
      expect(shown.headers.get("location"), site).toBe(
        "/gh/acme/secret-skills?lang=ko&sign_in=open",
      );
      expect(shown.headers.get("cache-control"), site).toBe("no-store");
      // Nothing was begun: no attempt is remembered in the browser.
      expect(shown.headers.getSetCookie(), site).toEqual([]);
    }
    expect((await begin("", "cross-site")).headers.get("location")).toBe("/?sign_in=open");
    // The way back is a page of this origin there too, or the front page.
    expect(
      (await begin("?return_to=https%3A%2F%2Fevil.test%2F", "cross-site")).headers.get("location"),
    ).toBe("/?sign_in=open");

    // From its own pages, and from a browser too old to say where it comes from, it begins.
    for (const site of ["same-origin", undefined]) {
      const begun = await begin("?return_to=%2Fexplore", site);
      expect(new URL(begun.headers.get("location") ?? "").origin, String(site)).toBe(
        "https://git.test",
      );
      expect(begun.headers.getSetCookie(), String(site)).toHaveLength(1);
    }
  });

  it("signs out only when its own pages ask, and the session is gone for good", async () => {
    const h = harness();
    const cookie = await h.signIn("bob");
    const foreign = await h.request(AUTH_ROUTES.logout, {
      method: "POST",
      headers: { cookie, origin: "https://evil.test" },
    });
    expect(foreign.status).toBe(403);
    const unnamed = await h.request(AUTH_ROUTES.logout, { method: "POST", headers: { cookie } });
    expect(unnamed.status).toBe(403);
    expect(
      restMeSchema.parse(await (await h.request("/api/v1/me", { headers: { cookie } })).json()).user
        ?.login,
    ).toBe("bob");

    const out = await h.request(AUTH_ROUTES.logout, {
      method: "POST",
      headers: { cookie, origin: h.origin },
    });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toMatch(/^__Host-skillcdn_session=; .*Max-Age=0/);
    expect(
      restMeSchema.parse(await (await h.request("/api/v1/me", { headers: { cookie } })).json()),
    ).toEqual({ user: null });
  });

  it("does not exist on a deployment that is not configured for it", async () => {
    const { request } = createHarness(testDatabase);
    for (const path of [
      AUTH_ROUTES.login,
      "/api/v1/me",
      "/.well-known/oauth-authorization-server/oauth",
      "/.well-known/oauth-protected-resource/gh/acme/secret-skills",
    ]) {
      expect((await request(path)).status, path).toBe(404);
    }
  });
});

describe("a private repository", () => {
  it("is nothing to someone who is not signed in, and the app is never asked about it", async () => {
    const host = createFixtureHost("auth-anonymous");
    const h = harness({ host });
    const missing = await h.request("/api/v1/mounts/gh/acme/no-such-repo");
    const hidden = await h.request(SECRET);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    // Asked as the deployment, as for any name; never through the installation.
    expect(host.asked.filter((call) => call.repo === "secret-skills")).toEqual([
      { method: "getRepository", repo: "secret-skills", credential: "deployment" },
    ]);
    // And remembered as missing, like any name that is nothing to the public.
    await h.request(SECRET);
    expect(host.asked.filter((call) => call.repo === "secret-skills")).toHaveLength(1);
  });

  it("is served to a person the git host lets see it, read through the app's installation", async () => {
    const host = createFixtureHost("auth-alice");
    const h = harness({ host });
    const cookie = await h.signIn("alice");
    const response = await h.request(SECRET, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const mount = restMountSchema.parse(await response.json());
    expect(mount.repository).toMatchObject({ name: "secret-skills", visibility: "private" });

    await h.snapshots.idle();
    const ready = restMountSchema.parse(
      await (await h.request(SECRET, { headers: { cookie } })).json(),
    );
    expect(ready.index).toMatchObject({ status: "ready", skillCount: 2 });
    const reads = host.asked.filter(
      (call) => call.repo === "secret-skills" && call.method !== "getRepository",
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((call) => call.credential === "installation")).toBe(true);

    const skill = await h.request(
      "/api/v1/skills/gh/acme/secret-skills?path=skills/release-notes/SKILL.md",
      { headers: { cookie } },
    );
    expect(skill.status).toBe(200);
    // The same request from nobody is still a repository that does not exist.
    expect((await h.request(SECRET)).status).toBe(404);
    expect(
      (await h.request("/api/v1/skills/gh/acme/secret-skills?path=skills/release-notes/SKILL.md"))
        .status,
    ).toBe(404);
  });

  it("is nothing to a person who cannot see it, and the app is not asked for them either", async () => {
    const host = createFixtureHost("auth-carol");
    const h = harness({ host });
    const carol = await h.signIn("carol");
    const bob = await h.signIn("bob");
    const missing = await h.request("/api/v1/mounts/gh/acme/no-such-repo", {
      headers: { cookie: carol },
    });
    const hidden = await h.request(SECRET, { headers: { cookie: carol } });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    expect(host.asked.some((call) => call.credential === "installation")).toBe(false);

    // One person's access is not another's.
    expect((await h.request(SECRET, { headers: { cookie: bob } })).status).toBe(200);
    expect(
      (await h.request("/api/v1/mounts/gh/acme/other-secrets", { headers: { cookie: bob } }))
        .status,
    ).toBe(404);
    expect((await h.request(SECRET, { headers: { cookie: carol } })).status).toBe(404);
  });

  it("answers an outsider after the same work, whether the name is nothing or a repository in use", async () => {
    const host = createFixtureHost("auth-oracle");
    const login = createFixtureLogin();
    const h = harness({ host, login });
    // Somebody who may see it has it open, again and again: the server knows it, freshly.
    const alice = await h.signIn("alice");
    for (let visit = 0; visit < 3; visit += 1) {
      expect((await h.request(SECRET, { headers: { cookie: alice } })).status).toBe(200);
    }
    // Indexing asks the host too; what follows counts only what a request causes.
    await h.snapshots.idle();
    // Nobody in particular asked about either name lately: the tests before this one did, and
    // what they left is what any such question leaves, for the one name as for the other.
    await deleteStaleMissingRepos(testDatabase.database, new Date(Date.now() + 86_400_000));

    /** One request, and everything the git host was asked because of it. */
    const probe = async (replica: Harness, path: string, cookie?: string) => {
      const before = { host: host.asked.length, person: login.calls.visibleRepository };
      const response = await replica.request(
        path,
        cookie === undefined ? {} : { headers: { cookie } },
      );
      return {
        status: response.status,
        body: await response.json(),
        asDeployment: host.asked
          .slice(before.host)
          .map((call) => `${call.method} as ${call.credential}`),
        asPerson: login.calls.visibleRepository - before.person,
      };
    };
    const NOTHING = "/api/v1/mounts/gh/acme/nothing-by-this-name";

    // From nobody in particular: the first question about the repository in use costs what
    // the first question about a name that is nothing costs. What its own people ask leaves
    // nothing behind that answers a stranger sooner.
    const hiddenToAnyone = await probe(h, SECRET);
    const nothingToAnyone = await probe(h, NOTHING);
    expect(hiddenToAnyone).toEqual(nothingToAnyone);
    expect(hiddenToAnyone).toMatchObject({
      status: 404,
      asDeployment: ["getRepository as deployment"],
      asPerson: 0,
    });

    // From a person who signed in and may not see it: the same, on a server that never heard
    // from them, and again once it has.
    const carol = await h.signIn("carol");
    const fresh = harness({ host, login });
    const hiddenToCarol = await probe(fresh, SECRET, carol);
    const nothingToCarol = await probe(fresh, NOTHING, carol);
    expect(hiddenToCarol).toEqual(nothingToCarol);
    expect(hiddenToCarol).toMatchObject({ status: 404, asPerson: 1 });
    expect(await probe(fresh, SECRET, carol)).toEqual(await probe(fresh, NOTHING, carol));
    expect(await probe(fresh, SECRET, carol)).toMatchObject({ asDeployment: [], asPerson: 0 });

    // Nothing about her was written where every replica reads it: another one asks the host
    // about the one name exactly as it does about the other.
    const another = harness({ host, login });
    expect(await probe(another, SECRET, carol)).toEqual(await probe(another, NOTHING, carol));
    expect(await probe(another, SECRET, carol)).toMatchObject({ status: 404 });
    // And the people who may see it still do.
    expect((await h.request(SECRET, { headers: { cookie: alice } })).status).toBe(200);
  });

  it("asks the git host again once its answer is older than it is believed for", async () => {
    const clock = movableClock();
    const login = createFixtureLogin();
    const h = harness({ login, clock, permissionTtlMs: 60_000, ttlMs: 3_600_000 });
    const cookie = await h.signIn("bob");
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    const asked = login.calls.visibleRepository;
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    expect(login.calls.visibleRepository).toBe(asked);

    // The host takes the access back. The old answer stands until it is too old, and no longer.
    const bob = login.people.bob;
    if (bob !== undefined) bob.sees.length = 0;
    clock.advance(30_000);
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    clock.advance(31_000);
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(404);
    expect(login.calls.visibleRepository).toBe(asked + 1);
  });

  it("is not served on an old answer when the git host cannot be asked", async () => {
    const clock = movableClock();
    const login = createFixtureLogin();
    const h = harness({ login, clock, permissionTtlMs: 60_000, ttlMs: 3_600_000 });
    const cookie = await h.signIn("alice");
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    clock.advance(61_000);
    login.unreachable(true);
    const response = await h.request(SECRET, { headers: { cookie } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "mount.unavailable" } });
    login.unreachable(false);
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
  });

  it("renews a credential the git host issued with an expiry, without the person noticing", async () => {
    const clock = movableClock();
    const login = createFixtureLogin({ expiring: true, now: clock.now });
    const h = harness({ login, clock, permissionTtlMs: 0 });
    const cookie = await h.signIn("alice");
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    expect(login.calls.refresh).toBe(0);

    clock.advance(9 * 3_600_000);
    login.expireAccessTokens();
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    expect(login.calls.refresh).toBe(1);
    // The renewed credential is the one that is kept and used from then on.
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    expect(login.calls.refresh).toBe(1);
  });

  it("signs a person out everywhere once the git host no longer accepts their credential", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const cookie = await h.signIn("alice");
    expect((await h.request(SECRET, { headers: { cookie } })).status).toBe(200);
    login.revoke("alice");
    const refused = await h.request(SECRET, { headers: { cookie } });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });
    expect(
      restMeSchema.parse(await (await h.request("/api/v1/me", { headers: { cookie } })).json()),
    ).toEqual({ user: null });
    // Signing in again is all it takes to be back.
    const again = await h.signIn("alice");
    expect((await h.request(SECRET, { headers: { cookie: again } })).status).toBe(200);
  });

  it("is listed for the person who can reach it through the app, and for nobody else", async () => {
    const h = harness();
    expect((await h.request("/api/v1/me/repositories")).status).toBe(401);
    const bob = await h.request("/api/v1/me/repositories", {
      headers: { cookie: await h.signIn("bob") },
    });
    expect(restMyRepositoriesSchema.parse(await bob.json())).toEqual({
      installUrl: FIXTURE_INSTALL_URL,
      installations: [
        {
          account: {
            login: "Acme",
            kind: "organization",
            avatar: "https://avatars.githubusercontent.com/u/42?s=160&v=4",
          },
          manageUrl: "https://git.test/organizations/Acme/settings/installations/7",
          selection: "selected",
          repositories: [
            {
              address: "/gh/acme/secret-skills",
              owner: "Acme",
              name: "secret-skills",
              description: "Skills only Acme's own people see.",
              visibility: "private",
            },
          ],
          truncated: false,
        },
      ],
      truncated: false,
    });
    const carol = await h.request("/api/v1/me/repositories", {
      headers: { cookie: await h.signIn("carol") },
    });
    expect(restMyRepositoriesSchema.parse(await carol.json())).toMatchObject({
      installUrl: FIXTURE_INSTALL_URL,
      installations: [],
    });
  });
});

describe("a public repository", () => {
  it("is resolved for a signed-in person as for anyone, with nothing looked up about them", async () => {
    const host = createFixtureHost("auth-public-first");
    const h = harness({ host });
    const user = await h.auth?.sessions.resolve(await h.signIn("carol"));
    if (user === undefined) {
      throw new Error("expected a signed-in person");
    }
    // Everything the resolution wants to know about the person, in the order it asks, who
    // they are included.
    const asked: string[] = [];
    const permissions: RepoPermissions = {
      missed: () => {
        asked.push("missed");
        return false;
      },
      noteMiss: () => {
        asked.push("noteMiss");
      },
      readable: async () => {
        asked.push("readable");
        return undefined;
      },
      visibleRepository: async () => {
        asked.push("visibleRepository");
        return undefined;
      },
      remember: async () => {
        asked.push("remember");
      },
    };
    const mounts = new MountService({
      database: testDatabase.database,
      gitHost: host,
      clock: { now: () => new Date() },
      entitlements: allowEverything,
      repoTtlMs: 60_000,
      refTtlMs: 60_000,
      staleGraceMs: 0,
      isVerified: async () => false,
      imageOf: async () => undefined,
      permissions,
    });
    const viewer = async () => {
      asked.push("who");
      return user;
    };
    const addressOf = (path: string) => {
      const parsed = parseAddress(path);
      if (!parsed.ok) {
        throw new Error(`not an address: ${path}`);
      }
      return parsed.value;
    };

    // Somebody opened it before, so it is known to be public. A person is then answered as
    // anyone is, before it is even asked who they are: what everyone may read needs nobody's
    // permission.
    await mounts.resolve(addressOf("/gh/acme/multi-skill"));
    const mount = await mounts.resolve(addressOf("/gh/acme/multi-skill"), viewer);
    expect(mount.repo.repository.visibility).toBe("public");
    expect(asked).toEqual([]);

    // A name that is not known to be public is looked up for the person, as it has to be.
    await expect(
      mounts.resolve(addressOf("/gh/acme/nothing-by-this-name"), viewer),
    ).rejects.toMatchObject({ reason: "repo_not_found" });
    expect(asked).toEqual(["who", "missed", "readable", "visibleRepository", "noteMiss"]);
  });
});
