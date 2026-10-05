import { createHmac, randomUUID } from "node:crypto";
import { restMeSchema, restMountSchema } from "@skillcdn/core";
import {
  findRepoByAlias,
  findUserByHostAccount,
  getUserCredentials,
  purgeRepository,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { createGitHubEvents } from "@skillcdn/github";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFixtureHost, fixtureCommits, fixtureRepoId } from "./testing/fixture-host.js";
import { createFixtureLogin } from "./testing/fixture-login.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

// Made up here: what the host and the deployment would share.
const SECRET = "a webhook secret for tests, long enough to be one";
/** The fixture host's account `acme`, as the host numbers it. */
const ACME = 42;

/** A harness that receives the git host's events, as a deployment that shares a secret does. */
function harness(options: HarnessOptions = {}) {
  return createHarness(testDatabase, {
    events: createGitHubEvents({ secret: SECRET }),
    ...options,
  });
}

const signatureOf = (body: string, secret = SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/** Delivers an event as the host does: the payload as JSON, signed over its bytes. */
function deliver(
  h: Pick<Harness, "request">,
  event: string,
  payload: unknown,
  options: { readonly signature?: string | null } = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = options.signature === undefined ? signatureOf(body) : options.signature;
  return h.request("/webhooks/gh", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "GitHub-Hookshot/test",
      "x-github-event": event,
      "x-github-delivery": randomUUID(),
      ...(signature === null ? {} : { "x-hub-signature-256": signature }),
    },
    body,
  });
}

const repository = (name: string) => ({ id: Number(fixtureRepoId(name)), name });

const MOUNT = "/api/v1/mounts/gh/acme";
async function mountOf(h: Pick<Harness, "request">, repo: string, cookie?: string) {
  const response = await h.request(
    `${MOUNT}/${repo}`,
    cookie === undefined ? {} : { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  return restMountSchema.parse(await response.json());
}
const commitOf = async (h: Pick<Harness, "request">, repo: string, cookie?: string) =>
  (await mountOf(h, repo, cookie)).commit;
/** How far the index of what the address serves has come: `ready` only while it is kept. */
const indexOf = async (h: Pick<Harness, "request">, repo: string, cookie?: string) =>
  (await mountOf(h, repo, cookie)).index.status;

describe("the receiver of the git host's events", () => {
  it("does not exist on a deployment that shares no secret with the host", async () => {
    const h = createHarness(testDatabase);
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const response = await h.request("/webhooks/gh", {
      method: "POST",
      headers: { "x-github-event": "ping", "x-hub-signature-256": signatureOf(body) },
      body,
    });
    expect(response.status).toBe(404);
  });

  it("refuses what the host did not sign, whatever it says, and reads none of it", async () => {
    const host = createFixtureHost("webhook-unsigned");
    const h = harness({ host });
    const old = await commitOf(h, "multi-skill");
    host.push();
    const payload = { ref: "refs/heads/main", repository: repository("multi-skill") };
    const body = JSON.stringify(payload);

    for (const signature of [
      null,
      "",
      "sha256=",
      `sha1=${createHmac("sha1", SECRET).update(body).digest("hex")}`,
      signatureOf(body, "another secret, as long as the real one is"),
      signatureOf(`${body} `),
      signatureOf(body).slice(0, -2),
    ]) {
      const refused = await deliver(h, "push", payload, { signature });
      expect(refused.status).toBe(401);
      expect(refused.headers.get("cache-control")).toBe("no-store");
      expect(await refused.json()).toEqual({
        error: { code: "webhook.unsigned", message: "The delivery is not signed by the git host." },
      });
    }
    // Nothing ended: the ref is still believed.
    expect(await commitOf(h, "multi-skill")).toBe(old);
    expect(
      h.logs.filter((line) => line.msg === "a delivery of the git host was refused"),
    ).toHaveLength(7);
  });

  it("answers what it has no use for with success, and what it cannot read with a refusal", async () => {
    const h = harness();
    for (const [event, payload] of [
      ["ping", { zen: "Keep it logically awesome.", hook_id: 1 }],
      ["star", { action: "created", repository: repository("multi-skill") }],
      // About a repository that was never opened here: nothing to end.
      ["push", { ref: "refs/heads/main", repository: { id: 987_654_321 } }],
      ["repository", { action: "created", repository: { id: 987_654_322 } }],
    ] as const) {
      const response = await deliver(h, event, payload);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }

    // Signed by the host, and not what the event is read by.
    const lacking = await deliver(h, "push", { ref: "refs/heads/main" });
    expect(lacking.status).toBe(400);
    expect(await lacking.json()).toMatchObject({ error: { code: "webhook.malformed" } });
    const notJson = "payload=%7B%7D";
    const form = await h.request("/webhooks/gh", {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": signatureOf(notJson) },
      body: notJson,
    });
    expect(form.status).toBe(400);
    const unnamed = await h.request("/webhooks/gh", {
      method: "POST",
      headers: { "x-hub-signature-256": signatureOf("{}") },
      body: "{}",
    });
    expect(unnamed.status).toBe(400);

    const huge = "x".repeat(4 * 1024 * 1024 + 1);
    const tooLarge = await h.request("/webhooks/gh", {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": signatureOf(huge) },
      body: huge,
    });
    expect(tooLarge.status).toBe(413);
  });
});

describe("what an event ends", () => {
  it("a push: the refs of its repository are asked for again, at once", async () => {
    const host = createFixtureHost("webhook-push");
    const h = harness({ host });
    const old = await commitOf(h, "with-manifest");
    expect(old).toBe(fixtureCommits("webhook-push").main);
    const pushed = host.push();
    // Without an event the answer stands for as long as a ref is believed.
    expect(await commitOf(h, "with-manifest")).toBe(old);

    const response = await deliver(h, "push", {
      ref: "refs/heads/main",
      before: old,
      after: pushed,
      repository: repository("with-manifest"),
    });
    expect(response.status).toBe(204);
    expect(await commitOf(h, "with-manifest")).toBe(pushed);
    // Every process reads the same refs: one that never heard of the push serves it too.
    expect(await commitOf(harness({ host }), "with-manifest")).toBe(pushed);
    expect(h.logs.find((line) => line.msg === "git host event")).toMatchObject({
      event: "push",
      applied: ["refs_changed"],
      concerned: 1,
    });
  });

  it("a push says where to look, not what is there: the host is asked", async () => {
    const host = createFixtureHost("webhook-claim");
    const h = harness({ host });
    const old = await commitOf(h, "licensed");
    // A delivery that names a commit the host does not have at the ref, as one that arrives
    // late or twice does.
    await deliver(h, "push", {
      ref: "refs/heads/main",
      after: "f".repeat(40),
      repository: repository("licensed"),
    });
    expect(await commitOf(h, "licensed")).toBe(old);
  });

  it("a repository made private: it is served to nobody in particular no longer", async () => {
    const host = createFixtureHost("webhook-private");
    const h = harness({ host });
    expect((await h.request(`${MOUNT}/single-skill`)).status).toBe(200);
    host.hide("single-skill");
    // What was public is believed public for a while, without an event.
    expect((await h.request(`${MOUNT}/single-skill`)).status).toBe(200);

    const response = await deliver(h, "repository", {
      action: "privatized",
      repository: { ...repository("single-skill"), private: true },
    });
    expect(response.status).toBe(204);
    expect((await h.request(`${MOUNT}/single-skill`)).status).toBe(404);
    expect((await harness({ host }).request(`${MOUNT}/single-skill`)).status).toBe(404);
    const known = await findRepoByAlias(testDatabase.database, {
      host: "gh",
      owner: "acme",
      repo: "single-skill",
    });
    expect(known?.repository.visibility ?? "private").toBe("private");
  });

  it("an event that would open something opens nothing: the host is asked", async () => {
    const h = harness();
    expect((await h.request(`${MOUNT}/private-repo`)).status).toBe(404);
    for (const [event, action] of [
      ["repository", "publicized"],
      ["public", undefined],
    ] as const) {
      const response = await deliver(h, event, { action, repository: repository("private-repo") });
      expect(response.status).toBe(204);
      expect((await h.request(`${MOUNT}/private-repo`)).status).toBe(404);
    }
  });

  it("a change of who sees a repository: the answers about it are asked for again", async () => {
    const host = createFixtureHost("webhook-access");
    const login = createFixtureLogin();
    const h = harness({ host, login });
    const alice = await h.signIn("alice");
    const bob = await h.signIn("bob");
    await commitOf(h, "secret-skills", alice);
    await commitOf(h, "secret-skills", bob);

    // The host takes the repository away from Bob. Without an event he keeps reading it for
    // as long as the host's answer is believed.
    login.people.bob?.sees.splice(0);
    await commitOf(h, "secret-skills", bob);

    const asked = login.calls.visibleRepository;
    const response = await deliver(h, "member", {
      action: "removed",
      member: { id: 1002, login: "bob" },
      repository: { ...repository("secret-skills"), private: true },
    });
    expect(response.status).toBe(204);
    expect((await h.request(`${MOUNT}/secret-skills`, { headers: { cookie: bob } })).status).toBe(
      404,
    );
    // Whoever still sees it is asked about again too, and served.
    await commitOf(h, "secret-skills", alice);
    expect(login.calls.visibleRepository).toBe(asked + 2);
  });

  it("a change of who belongs to an account: the answers about all it has are asked for again", async () => {
    const host = createFixtureHost("webhook-members");
    const login = createFixtureLogin();
    const h = harness({ host, login });
    const alice = await h.signIn("alice");
    await commitOf(h, "secret-skills", alice);
    await commitOf(h, "other-secrets", alice);

    for (const [event, payload] of [
      ["organization", { action: "member_removed", organization: { id: ACME, login: "Acme" } }],
      ["membership", { action: "removed", organization: { id: ACME }, team: { id: 7 } }],
      ["team", { action: "deleted", organization: { id: ACME }, team: { id: 7 } }],
      ["installation", { action: "suspend", installation: { id: 7, account: { id: ACME } } }],
    ] as const) {
      const asked = login.calls.visibleRepository;
      expect((await deliver(h, event, payload)).status).toBe(204);
      await commitOf(h, "secret-skills", alice);
      await commitOf(h, "other-secrets", alice);
      expect(login.calls.visibleRepository).toBe(asked + 2);
    }

    // A team given or taken a repository names the repository: only it is asked about again.
    const asked = login.calls.visibleRepository;
    for (const event of ["team", "team_add"] as const) {
      const response = await deliver(h, event, {
        action: "added_to_repository",
        organization: { id: ACME },
        repository: repository("other-secrets"),
      });
      expect(response.status).toBe(204);
    }
    await commitOf(h, "secret-skills", alice);
    await commitOf(h, "other-secrets", alice);
    expect(login.calls.visibleRepository).toBe(asked + 1);
  });

  it("the app taken off a repository: what was read of it is removed, and it is served to nobody", async () => {
    const host = createFixtureHost("webhook-uninstall");
    const login = createFixtureLogin();
    const h = harness({ host, login });
    const alice = await h.signIn("alice");
    await vi.waitFor(async () => {
      expect(await indexOf(h, "secret-skills", alice)).toBe("ready");
      expect(await indexOf(h, "multi-skill")).toBe("ready");
    });

    host.uninstall("secret-skills");
    // Without an event its people go on reading what was indexed, for as long as the host's
    // answers are believed.
    expect(await indexOf(h, "secret-skills", alice)).toBe("ready");

    const response = await deliver(h, "installation_repositories", {
      action: "removed",
      installation: { id: 7, account: { id: ACME } },
      repository_selection: "selected",
      repositories_added: [],
      repositories_removed: [{ ...repository("secret-skills"), private: true }],
    });
    expect(response.status).toBe(204);
    // Nothing of it is left to remove.
    const alias = { host: "gh", owner: "acme", repo: "secret-skills" } as const;
    expect((await purgeRepository(testDatabase.database, alias))?.snapshots).toBe(0);
    expect((await h.request(`${MOUNT}/secret-skills`, { headers: { cookie: alice } })).status).toBe(
      404,
    );
    // What is public was read as anyone reads it, and stays.
    expect(await indexOf(h, "multi-skill")).toBe("ready");
  });

  it("the app taken off an account: every private repository of it goes the same way", async () => {
    const host = createFixtureHost("webhook-uninstall-all");
    const login = createFixtureLogin();
    const h = harness({ host, login });
    const alice = await h.signIn("alice");
    await vi.waitFor(async () => {
      expect(await indexOf(h, "secret-skills", alice)).toBe("ready");
      expect(await indexOf(h, "other-secrets", alice)).toBe("ready");
      expect(await indexOf(h, "hostile")).toBe("ready");
    });

    const response = await deliver(h, "installation", {
      action: "deleted",
      installation: { id: 7, account: { id: ACME, login: "Acme", type: "Organization" } },
      repositories: [],
    });
    expect(response.status).toBe(204);
    const alias = { host: "gh", owner: "acme" } as const;
    for (const repo of ["secret-skills", "other-secrets"]) {
      expect((await purgeRepository(testDatabase.database, { ...alias, repo }))?.snapshots).toBe(0);
    }
    expect(await indexOf(h, "hostile")).toBe("ready");
  });

  it("a person who takes back what they allowed the app: signed out, with everything of theirs", async () => {
    const login = createFixtureLogin();
    const h = harness({ login });
    const alice = await h.signIn("alice");
    const bob = await h.signIn("bob");
    const me = async (cookie: string) =>
      restMeSchema.parse(await (await h.request("/api/v1/me", { headers: { cookie } })).json())
        .user;
    expect((await me(alice))?.login).toBe("Alice");

    // Somebody else's revocation, and one of an account that never signed in here.
    for (const sender of [1001, 5555]) {
      const response = await deliver(h, "github_app_authorization", {
        action: "revoked",
        sender: { id: sender },
      });
      expect(response.status).toBe(204);
    }
    expect(await me(alice)).toBeNull();
    expect((await me(bob))?.login).toBe("bob");
    // An event about nobody this deployment knows is not worth a line of the log.
    const noted = h.logs.filter((line) => line.msg === "git host event");
    expect(noted.map((line) => [line.event, line.concerned])).toEqual([
      ["github_app_authorization.revoked", 1],
    ]);
    // The host's credential of the person is forgotten with the rest.
    const stored = await Promise.all(
      ["1001", "1002"].map(async (hostAccountId) => {
        const user = await findUserByHostAccount(testDatabase.database, {
          host: "gh",
          hostAccountId,
        });
        return user === undefined
          ? "nobody"
          : (await getUserCredentials(testDatabase.database, user.id)) === undefined
            ? "forgotten"
            : "kept";
      }),
    );
    expect(stored).toEqual(["forgotten", "kept"]);
  });
});
