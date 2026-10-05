import {
  REPO_TOKEN_PREFIX,
  restMeSchema,
  restNewRepoTokenSchema,
  restRepoTokensSchema,
} from "@skillcdn/core";
import {
  findRepoByAlias,
  findUserByHostAccount,
  saveRepoPermission,
  saveRepository,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_REPO_TOKENS_PER_USER } from "./auth/repo-tokens.js";
import { createFixtureLogin, type FixtureLogin } from "./testing/fixture-login.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

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

let newcomers = 0;
/**
 * A person nobody else in this file is. The tests share a database, and what a person made
 * stays theirs from one test to the next: each test has people of its own.
 */
function newcomer(login: FixtureLogin, sees = ["secret-skills", "other-secrets"]): string {
  newcomers += 1;
  const name = `newcomer-${newcomers}`;
  login.people[name] = {
    user: { hostAccountId: String(7000 + newcomers), login: name, name: undefined },
    sees: [...sees],
  };
  return name;
}

const TOKENS = "/api/v1/me/tokens";
const SECRET = "/gh/acme/secret-skills";
const DAY_MS = 86_400_000;
const MCP_HEADERS = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};
const LIST_TOOLS = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

/** A request an agent makes to an address, with the token it was given when it was given one. */
const mcp = (h: Pick<Harness, "request">, address: string, token?: string) =>
  h.request(address, {
    method: "POST",
    headers: {
      ...MCP_HEADERS,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: LIST_TOOLS,
  });

/** What the pages send to make a token: from the deployment's own origin, with the session. */
const make = (
  h: Pick<Harness, "request" | "origin">,
  cookie: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  h.request(TOKENS, {
    method: "POST",
    headers: { cookie, origin: h.origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function tokenFor(
  h: Pick<Harness, "request" | "origin">,
  cookie: string,
  address = SECRET,
  expiresInDays = 30,
) {
  const response = await make(h, cookie, { address, label: "The nightly job", expiresInDays });
  expect(response.status).toBe(201);
  return restNewRepoTokenSchema.parse(await response.json());
}

const listOf = async (h: Pick<Harness, "request">, cookie: string) =>
  restRepoTokensSchema.parse(await (await h.request(TOKENS, { headers: { cookie } })).json());

describe("making a token", () => {
  it("takes a person who is signed in, on the deployment's own pages", async () => {
    const h = harness();
    const cookie = await h.signIn(newcomer(h.login));
    const body = { address: SECRET, label: "CI", expiresInDays: 30 };
    const anonymous = await h.request(TOKENS, {
      method: "POST",
      headers: { origin: h.origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(anonymous.status).toBe(401);
    expect((await h.request(TOKENS)).status).toBe(401);
    // The cookie alone is not enough: the request has to come from the site itself.
    for (const origin of [undefined, "https://elsewhere.example"]) {
      const foreign = await h.request(TOKENS, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          ...(origin === undefined ? {} : { origin }),
        },
        body: JSON.stringify(body),
      });
      expect(foreign.status).toBe(403);
      expect(await foreign.json()).toMatchObject({ error: { code: "auth.forbidden_origin" } });
    }
    expect((await listOf(h, cookie)).items).toEqual([]);
  });

  it("hands out the secret once, and keeps what says whose it is and where it is good", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const cookie = await h.signIn(newcomer(h.login));
    const before = clock.now().getTime();
    const response = await make(h, cookie, {
      address: "/gh/Acme/Secret-Skills",
      label: "  The nightly job  ",
      expiresInDays: 90,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const made = restNewRepoTokenSchema.parse(await response.json());
    expect(made.token).toMatch(new RegExp(`^${REPO_TOKEN_PREFIX}[\\w-]{40,}$`));
    expect(made.item).toMatchObject({
      address: SECRET,
      label: "The nightly job",
      lastUsedAt: null,
    });
    const lifetime = Date.parse(made.item.expiresAt) - Date.parse(made.item.createdAt);
    expect(lifetime).toBe(90 * DAY_MS);
    expect(Date.parse(made.item.createdAt)).toBeGreaterThanOrEqual(before);

    // The list shows what was stored, and nothing a token could be made from again.
    const listed = await listOf(h, cookie);
    expect(listed).toEqual({ items: [made.item], limit: MAX_REPO_TOKENS_PER_USER });
    expect(JSON.stringify(listed)).not.toContain(made.token);
    expect(JSON.stringify(h.logs)).not.toContain(made.token);
    // Another person's list is their own.
    expect((await listOf(h, await h.signIn(newcomer(h.login)))).items).toEqual([]);
  });

  it("is for a repository the person can open, and tells nothing about any other", async () => {
    const h = harness();
    const bob = await h.signIn(newcomer(h.login, ["secret-skills"]));
    const attempt = async (address: string) => {
      const response = await make(h, bob, { address, label: "CI", expiresInDays: 30 });
      return { status: response.status, body: await response.json() };
    };
    // Bob sees one of the two private repositories. The other is to him what a name that is
    // nothing is: the same answer, in the same words.
    expect((await attempt(SECRET)).status).toBe(201);
    const hidden = await attempt("/gh/acme/other-secrets");
    expect(hidden).toEqual(await attempt("/gh/acme/nothing-by-this-name"));
    expect(hidden).toMatchObject({
      status: 404,
      body: { error: { code: "mount.repo_not_found" } },
    });

    // What everyone reads needs no token.
    expect(await attempt("/gh/acme/multi-skill")).toMatchObject({
      status: 400,
      body: { error: { code: "token.public_repository" } },
    });
    // A token is a repository's: not a branch's, not a folder's.
    for (const address of [`${SECRET}@main`, `${SECRET}/skills`]) {
      expect(await attempt(address)).toMatchObject({
        status: 400,
        body: { error: { code: "token.not_a_repository" } },
      });
    }
    expect((await listOf(h, bob)).items).toHaveLength(1);
  });

  it("refuses what is not a repository, a name and a lifetime", async () => {
    const h = harness();
    const cookie = await h.signIn(newcomer(h.login));
    const good = { address: SECRET, label: "CI", expiresInDays: 30 };
    for (const body of [
      undefined,
      "not an object",
      {},
      { ...good, address: "" },
      { ...good, address: "/gh/acme" },
      { ...good, address: "https://example.com/gh/acme/secret-skills" },
      { ...good, label: "" },
      { ...good, label: "   " },
      { ...good, label: "x".repeat(61) },
      { ...good, label: `C${String.fromCodePoint(0x202e)}I` },
      { ...good, label: 7 },
      { ...good, expiresInDays: 0 },
      { ...good, expiresInDays: 367 },
      { ...good, expiresInDays: 1.5 },
      { ...good, expiresInDays: "30" },
    ]) {
      const response = await make(h, cookie, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "token.invalid" } });
    }
    const huge = await make(h, cookie, { ...good, label: "x".repeat(70_000) });
    expect(huge.status).toBe(413);
    expect((await listOf(h, cookie)).items).toEqual([]);
  });

  it("is not answered while the git host cannot say whether the repository is theirs", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const cookie = await h.signIn(newcomer(h.login));
    login.unreachable(true);
    const response = await make(h, cookie, { address: SECRET, label: "CI", expiresInDays: 30 });
    expect(response.status).toBe(503);
    login.unreachable(false);
    expect((await listOf(h, cookie)).items).toEqual([]);
  });

  it("is bounded: one more than a person may hold is refused, and nothing is ended for it", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const cookie = await h.signIn(newcomer(h.login));
    const first = await tokenFor(h, cookie, SECRET, 1);
    for (let made = 1; made < MAX_REPO_TOKENS_PER_USER; made += 1) {
      await tokenFor(h, cookie, SECRET, 30);
    }
    const full = await make(h, cookie, { address: SECRET, label: "One more", expiresInDays: 30 });
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: { code: "token.limit" } });
    expect((await mcp(h, SECRET, first.token)).status).toBe(200);
    // One that has expired is held no longer.
    clock.advance(DAY_MS + 1000);
    expect((await listOf(h, cookie)).items).toHaveLength(MAX_REPO_TOKENS_PER_USER - 1);
    await tokenFor(h, cookie);
  });
});

describe("an agent with a token", () => {
  it("reads every address of the repository the token was made for, as its maker", async () => {
    const h = harness();
    const cookie = await h.signIn(newcomer(h.login));
    const { token } = await tokenFor(h, cookie);
    expect((await mcp(h, SECRET)).status).toBe(401);
    for (const address of [
      SECRET,
      "/gh/Acme/Secret-Skills",
      `${SECRET}@main`,
      `${SECRET}@release/1.2:`,
      `${SECRET}/skills`,
      `${SECRET}@release/1.2:docs`,
    ]) {
      const response = await mcp(h, address, token);
      expect(response.status, address).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    // That it was used is noted beside the request, which does not wait for the note.
    await vi.waitFor(
      async () => {
        expect((await listOf(h, cookie)).items[0]?.lastUsedAt).not.toBeNull();
      },
      { timeout: 5_000, interval: 25 },
    );
  });

  it("reads nothing else with it, and is told that the token is no good there", async () => {
    const h = harness();
    const { token } = await tokenFor(h, await h.signIn(newcomer(h.login)));
    // Another private repository of the same person, a name that is nothing, and a path that
    // is not an address of the repository at all: one answer.
    const refusals = [];
    for (const address of ["/gh/acme/other-secrets", "/gh/acme/nothing-by-this-name"]) {
      const response = await mcp(h, address, token);
      expect(response.status, address).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
      refusals.push(await response.json());
    }
    expect(refusals[0]).toEqual(refusals[1]);
    expect(refusals[0]).toMatchObject({ error: { code: "auth.invalid_token" } });
    // What everyone is served is served with it as without it.
    expect((await mcp(h, "/gh/acme/multi-skill", token)).status).toBe(200);
    // The pages and the REST API know people by their session, never by a token.
    const rest = await h.request("/api/v1/mounts/gh/acme/secret-skills", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rest.status).toBe(404);
    const me = await h.request("/api/v1/me", { headers: { authorization: `Bearer ${token}` } });
    expect(restMeSchema.parse(await me.json()).user).toBeNull();
  });

  it("is refused once the token expired or was taken back, and by nobody but its maker", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const alice = await h.signIn(newcomer(h.login));
    const short = await tokenFor(h, alice, SECRET, 1);
    const long = await tokenFor(h, alice, SECRET, 30);
    expect((await mcp(h, SECRET, short.token)).status).toBe(200);

    clock.advance(DAY_MS + 1000);
    const expired = await mcp(h, SECRET, short.token);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: { code: "auth.invalid_token" } });
    expect((await listOf(h, alice)).items.map((item) => item.id)).toEqual([long.item.id]);

    const path = `${TOKENS}/${long.item.id}`;
    const bob = await h.signIn(newcomer(h.login));
    const byAnother = await h.request(path, {
      method: "DELETE",
      headers: { cookie: bob, origin: h.origin },
    });
    expect(byAnother.status).toBe(404);
    expect((await h.request(path, { method: "DELETE", headers: { cookie: alice } })).status).toBe(
      403,
    );
    expect((await mcp(h, SECRET, long.token)).status).toBe(200);

    const removed = await h.request(path, {
      method: "DELETE",
      headers: { cookie: alice, origin: h.origin },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: long.item.id, removed: true });
    expect((await mcp(h, SECRET, long.token)).status).toBe(401);
    for (const id of [long.item.id, "not-an-id"]) {
      const again = await h.request(`${TOKENS}/${id}`, {
        method: "DELETE",
        headers: { cookie: alice, origin: h.origin },
      });
      expect(again.status).toBe(404);
    }
    // Something that only looks like a token of this kind is no better than none.
    expect((await mcp(h, SECRET, `${REPO_TOKEN_PREFIX}made-up`)).status).toBe(401);
  });

  it("reads only what the git host still shows its maker", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const maker = newcomer(login, ["secret-skills"]);
    const { token } = await tokenFor(h, await h.signIn(maker));
    expect((await mcp(h, SECRET, token)).status).toBe(200);

    // The host takes the repository away from them: the token is theirs, and reads what they read.
    login.people[maker]?.sees.splice(0);
    const gone = await mcp(h, SECRET, token);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });
    // While the host cannot be asked there is no answer, and no access.
    login.people[maker]?.sees.push("secret-skills");
    expect((await mcp(h, SECRET, token)).status).toBe(200);
    login.unreachable(true);
    expect((await mcp(h, SECRET, token)).status).toBe(503);
  });

  it("loses the token with everything else of its maker's when the git host stops vouching for them", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const maker = newcomer(login);
    const { token } = await tokenFor(h, await h.signIn(maker));
    expect((await mcp(h, SECRET, token)).status).toBe(200);

    login.revoke(maker);
    const refused = await mcp(h, SECRET, token);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: { code: "auth.invalid_token" } });
    // Signing in again does not bring it back: it went with the credential it stood on.
    const again = await h.signIn(maker);
    expect((await listOf(h, again)).items).toEqual([]);
    expect((await mcp(h, SECRET, token)).status).toBe(401);
  });

  it("is not good for another repository that was given the name it was made under", async () => {
    const login = createFixtureLogin();
    const h = harness({ login });
    const maker = newcomer(login);
    const { token } = await tokenFor(h, await h.signIn(maker));
    expect((await mcp(h, SECRET, token)).status).toBe(200);

    // The name comes to mean another repository, one its maker can read as well: what the
    // token is bound to is the repository, and the name alone does not make an address its own.
    const { database } = testDatabase;
    const alias = { host: "gh", owner: "acme", repo: "secret-skills" } as const;
    const original = await findRepoByAlias(database, alias);
    const user = await findUserByHostAccount(database, {
      host: "gh",
      hostAccountId: login.people[maker]?.user.hostAccountId ?? "",
    });
    if (original === undefined || user === undefined) {
      throw new Error("the repository and its reader were not saved");
    }
    const other = await saveRepository(
      database,
      alias,
      { ...original.repository, hostRepoId: "424242" },
      new Date(),
    );
    await saveRepoPermission(database, { userId: user.id, repoId: other.id }, true, new Date());
    try {
      const refused = await mcp(h, SECRET, token);
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
      expect(await refused.json()).toMatchObject({ error: { code: "auth.invalid_token" } });
    } finally {
      // The name goes back to the repository the other tests of this file know it as.
      await saveRepository(database, alias, original.repository, new Date());
    }
    expect((await mcp(h, SECRET, token)).status).toBe(200);
  });
});
