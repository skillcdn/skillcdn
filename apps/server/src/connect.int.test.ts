import {
  CONNECT_SECRET_PREFIX,
  REPO_TOKEN_DEFAULT_DAYS,
  REPO_TOKEN_PREFIX,
  REST_ROUTES,
  restConnectClaimedSchema,
  restConnectStartedSchema,
  restConnectViewSchema,
  restRepoTokensSchema,
} from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONNECT_REQUEST_TTL_MS } from "./auth/connections.js";
import { createFixtureLogin, type FixtureLogin } from "./testing/fixture-login.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

// A command connecting with a code a person approves (docs/specs/permissions.md, ADR-0059).

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
/** A person nobody else in this file is: what a person made stays theirs from one test to the next. */
function newcomer(login: FixtureLogin, sees = ["secret-skills", "other-secrets"]): string {
  newcomers += 1;
  const name = `connecting-${newcomers}`;
  login.people[name] = {
    user: { hostAccountId: String(8000 + newcomers), login: name, name: undefined },
    sees: [...sees],
  };
  return name;
}

const CONNECT = REST_ROUTES.connect;
const SECRET = "/gh/acme/secret-skills";
const DAY_MS = 86_400_000;
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
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

/** What the command sends to begin: as nobody, from nowhere in particular. */
const begin = (h: Pick<Harness, "request">, body: unknown) =>
  h.request(CONNECT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function started(
  h: Pick<Harness, "request">,
  address = SECRET,
  agent = "Claude Code on a laptop",
) {
  const response = await begin(h, { address, agent });
  expect(response.status).toBe(201);
  return restConnectStartedSchema.parse(await response.json());
}

/** What the person's browser sends: with the session, from the deployment's own origin, or `null` for none. */
const decide = (
  h: Pick<Harness, "request" | "origin">,
  cookie: string,
  code: string,
  body: unknown,
  origin: string | null = h.origin,
) =>
  h.request(`${CONNECT}/${code}/decision`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      ...(origin === null ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });

const look = (h: Pick<Harness, "request">, cookie: string | undefined, code: string) =>
  h.request(`${CONNECT}/${code}`, { headers: cookie === undefined ? {} : { cookie } });

const claim = (h: Pick<Harness, "request">, secret: unknown) =>
  h.request(`${CONNECT}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret }),
  });

const tokensOf = async (h: Pick<Harness, "request">, cookie: string) =>
  restRepoTokensSchema.parse(
    await (await h.request(`${REST_ROUTES.me}/tokens`, { headers: { cookie } })).json(),
  );

describe("beginning a connection", () => {
  it("gives the command a code for the person and a secret for itself, and asks nothing about the repository", async () => {
    const h = harness();
    const response = await begin(h, {
      address: "/gh/Acme/Secret-Skills",
      agent: "  Codex on ci-7  ",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = restConnectStartedSchema.parse(await response.json());
    expect(body.code).toMatch(CODE);
    expect(body.url).toBe(`${h.origin}/connect/${body.code}`);
    expect(body.secret).toMatch(new RegExp(`^${CONNECT_SECRET_PREFIX}[\\w-]{40,}$`));
    expect(body.intervalSeconds).toBeGreaterThan(0);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(CONNECT_REQUEST_TTL_MS);
    // A name that is nothing begins a connection like any other: nobody learns anything here.
    const nothing = await begin(h, { address: "/gh/acme/nothing-by-this-name", agent: "An agent" });
    expect(nothing.status).toBe(201);
    expect(h.login.calls.visibleRepository).toBe(0);
    expect(JSON.stringify(h.logs)).not.toContain(body.secret);
  });

  it("refuses what is not a repository and what the command calls itself", async () => {
    const h = harness();
    const good = { address: SECRET, agent: "An agent" };
    for (const body of [
      undefined,
      {},
      { ...good, address: "" },
      { ...good, address: "/gh/acme" },
      { ...good, address: "local/packs/acme" },
      { ...good, agent: "" },
      { ...good, agent: "   " },
      { ...good, agent: "x".repeat(81) },
      { ...good, agent: `C${String.fromCodePoint(0x202e)}I` },
      { ...good, agent: 7 },
    ]) {
      const response = await begin(h, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "connect.invalid" } });
    }
    for (const address of [`${SECRET}@main`, `${SECRET}/skills`]) {
      const response = await begin(h, { ...good, address });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "token.not_a_repository" } });
    }
  });

  it("does not exist on a deployment where nobody signs in", async () => {
    const h = createHarness(testDatabase);
    expect((await begin(h, { address: SECRET, agent: "An agent" })).status).toBe(404);
    expect((await claim(h, "scdn_cx_nothing")).status).toBe(404);
  });
});

describe("looking at what asks to connect", () => {
  it("is for a person signed in, under the code however they typed it", async () => {
    const h = harness();
    const { code } = await started(h);
    expect((await look(h, undefined, code)).status).toBe(401);
    const cookie = await h.signIn(newcomer(h.login));
    for (const typed of [code, code.toLowerCase(), code.replace("-", "")]) {
      const response = await look(h, cookie, typed);
      expect(response.status, typed).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const view = restConnectViewSchema.parse(await response.json());
      expect(view).toMatchObject({
        code,
        agent: "Claude Code on a laptop",
        address: SECRET,
        approved: false,
        visible: true,
        installUrl: expect.stringContaining("https://"),
      });
      expect(view.user.login).toMatch(/^connecting-/);
    }
    // One that cannot open the repository is told so, in the same words as for a name that is nothing.
    const outsider = await h.signIn(newcomer(h.login, []));
    expect(restConnectViewSchema.parse(await (await look(h, outsider, code)).json()).visible).toBe(
      false,
    );
    const nothing = await started(h, "/gh/acme/nothing-by-this-name");
    expect(
      restConnectViewSchema.parse(await (await look(h, cookie, nothing.code)).json()).visible,
    ).toBe(false);
  });

  it("finds nothing under a code that is not one, is unknown, or whose time is up", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const cookie = await h.signIn(newcomer(h.login));
    const { code, secret } = await started(h);
    for (const wrong of ["ABCD", "ABCD-EFG0", "ZZZZ-ZZZZ"]) {
      const response = await look(h, cookie, wrong);
      expect(response.status, wrong).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "connect.not_found" } });
    }
    clock.advance(CONNECT_REQUEST_TTL_MS + 1000);
    expect((await look(h, cookie, code)).status).toBe(404);
    expect((await claim(h, secret)).status).toBe(404);
  });
});

describe("deciding", () => {
  it("takes a yes or a no from the person signed in, on the deployment's own pages", async () => {
    const h = harness();
    const cookie = await h.signIn(newcomer(h.login));
    const { code, secret } = await started(h);
    expect((await decide(h, cookie, code, { approve: true }, null)).status).toBe(403);
    expect(
      (await decide(h, cookie, code, { approve: true }, "https://elsewhere.example")).status,
    ).toBe(403);
    expect((await decide(h, "", code, { approve: true })).status).toBe(401);
    for (const body of [
      undefined,
      {},
      { approve: "yes" },
      { approve: true, label: "" },
      { approve: true, expiresInDays: 0 },
    ]) {
      const response = await decide(h, cookie, code, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "connect.invalid" } });
    }
    // Meanwhile the command waits.
    expect(await (await claim(h, secret)).json()).toMatchObject({ status: "pending" });

    const declined = await decide(h, cookie, code, { approve: false });
    expect(declined.status).toBe(200);
    expect(await declined.json()).toEqual({ status: "denied" });
    // A no spends the code: there is nothing under it for anyone, the command included.
    expect((await look(h, cookie, code)).status).toBe(404);
    expect((await decide(h, cookie, code, { approve: true })).status).toBe(404);
    expect((await claim(h, secret)).status).toBe(404);
  });

  it("approves only a private repository the person can open", async () => {
    const h = harness();
    const bob = await h.signIn(newcomer(h.login, ["secret-skills"]));
    const hidden = await started(h, "/gh/acme/other-secrets");
    const refused = await decide(h, bob, hidden.code, { approve: true });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });
    // Refused, not spent: someone who can open it may still approve it.
    const alice = await h.signIn(newcomer(h.login));
    expect(await (await decide(h, alice, hidden.code, { approve: true })).json()).toEqual({
      status: "approved",
    });

    // What everyone reads needs no connection, and the code is spent saying so.
    const open = await started(h, "/gh/acme/multi-skill");
    const pointless = await decide(h, alice, open.code, { approve: true });
    expect(pointless.status).toBe(400);
    expect(await pointless.json()).toMatchObject({ error: { code: "token.public_repository" } });
    expect((await claim(h, open.secret)).status).toBe(404);

    // Approved once: the view says so, and a second answer finds nothing to decide.
    expect(
      restConnectViewSchema.parse(await (await look(h, alice, hidden.code)).json()).approved,
    ).toBe(true);
    expect((await decide(h, alice, hidden.code, { approve: true })).status).toBe(404);
    expect((await decide(h, alice, hidden.code, { approve: false })).status).toBe(404);
  });

  it("is not answered while the git host cannot say whether the repository is theirs", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const cookie = await h.signIn(newcomer(h.login));
    const { code, secret } = await started(h);
    login.unreachable(true);
    expect((await decide(h, cookie, code, { approve: true })).status).toBe(503);
    login.unreachable(false);
    expect(await (await claim(h, secret)).json()).toMatchObject({ status: "pending" });
  });
});

describe("claiming", () => {
  it("hands the command a token for the repository, once, that reads as the person who approved", async () => {
    const h = harness();
    const cookie = await h.signIn(newcomer(h.login));
    const { code, secret } = await started(h, SECRET, "Codex on ci-7");
    for (const wrong of [undefined, "", "x".repeat(300), "scdn_cx_nothing"]) {
      const response = await claim(h, wrong);
      expect(response.status, String(wrong)).toBe(wrong === "scdn_cx_nothing" ? 404 : 400);
    }
    expect(await (await claim(h, secret)).json()).toMatchObject({ status: "pending" });

    expect(await (await decide(h, cookie, code, { approve: true })).json()).toEqual({
      status: "approved",
    });
    const before = Date.now();
    const response = await claim(h, secret);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const claimed = restConnectClaimedSchema.parse(await response.json());
    if (claimed.status !== "connected") {
      throw new Error("the claim was approved");
    }
    expect(claimed.token).toMatch(new RegExp(`^${REPO_TOKEN_PREFIX}[\\w-]{40,}$`));
    // Named after the command, good for the pages' default lifetime, as nothing else was said.
    expect(claimed.item).toMatchObject({
      address: SECRET,
      label: "Codex on ci-7",
      lastUsedAt: null,
    });
    expect(Date.parse(claimed.item.expiresAt) - Date.parse(claimed.item.createdAt)).toBe(
      REPO_TOKEN_DEFAULT_DAYS * DAY_MS,
    );
    expect(Date.parse(claimed.item.createdAt)).toBeGreaterThanOrEqual(before - 1000);

    // The token is the person's, listed with theirs, and reads the repository as they do.
    expect((await tokensOf(h, cookie)).items).toEqual([claimed.item]);
    expect((await mcp(h, SECRET, claimed.token)).status).toBe(200);
    expect((await mcp(h, "/gh/acme/other-secrets", claimed.token)).status).toBe(401);
    expect((await mcp(h, SECRET)).status).toBe(401);
    expect(JSON.stringify(h.logs)).not.toContain(claimed.token);
    expect(JSON.stringify(h.logs)).not.toContain(secret);

    // Handed over once: the code and the secret are spent.
    expect((await claim(h, secret)).status).toBe(404);
    expect((await look(h, cookie, code)).status).toBe(404);
  });

  it("names and times the token as the person chose", async () => {
    const h = harness();
    const cookie = await h.signIn(newcomer(h.login));
    const { code, secret } = await started(h);
    await decide(h, cookie, code, { approve: true, label: "  The laptop  ", expiresInDays: 7 });
    const claimed = restConnectClaimedSchema.parse(await (await claim(h, secret)).json());
    expect(claimed).toMatchObject({ status: "connected", item: { label: "The laptop" } });
    if (claimed.status === "connected") {
      expect(Date.parse(claimed.item.expiresAt) - Date.parse(claimed.item.createdAt)).toBe(
        7 * DAY_MS,
      );
    }
  });

  it("waits for the git host when it cannot be asked, and ends when the person lost the repository", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const person = newcomer(h.login, ["secret-skills"]);
    const cookie = await h.signIn(person);
    const { code, secret } = await started(h);
    await decide(h, cookie, code, { approve: true });

    login.unreachable(true);
    const down = await claim(h, secret);
    expect(down.status).toBe(503);
    login.unreachable(false);
    // Nothing was spent by a host that did not answer: the next claim is answered.
    const again = await claim(h, secret);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "connected" });

    // Approved, then taken away at the host before the command claimed: nothing is handed over.
    const second = await started(h);
    await decide(h, cookie, second.code, { approve: true });
    h.login.people[person] = {
      ...h.login.people[person],
      sees: [],
    } as (typeof h.login.people)[string];
    const lost = await claim(h, second.secret);
    expect(lost.status).toBe(404);
    expect(await lost.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });
    expect((await claim(h, second.secret)).status).toBe(404);
  });
});
