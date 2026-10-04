import { createHash, randomBytes } from "node:crypto";
import {
  Client,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { restAuthorizationSchema, restGrantsSchema } from "@skillcdn/core";
import { countUnusedOAuthClients } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createFixtureLogin, FIXTURE_INSTALL_URL } from "./testing/fixture-login.js";
import {
  createHarness,
  type Harness,
  type HarnessOptions,
  SIGN_IN_URL,
} from "./testing/harness.js";
import { textOf } from "./testing/tool-text.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

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

const SECRET = "/gh/acme/secret-skills";
/** Who issues the tokens: the deployment, under a path of its own. */
const ISSUER = `${SIGN_IN_URL}/oauth`;
const REDIRECT = "http://127.0.0.1:43110/callback";
const MCP_HEADERS = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};
const LIST_TOOLS = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** A client that registers itself, as most do today. */
async function register(h: Harness, metadata: Record<string, unknown> = {}) {
  const response = await h.request(
    "/oauth/register",
    json({ client_name: "Test client", redirect_uris: [REDIRECT], ...metadata }),
  );
  return { response, client: (await response.json()) as Record<string, string> };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The authorization URL a client would open, as a path of the deployment. */
function authorizeUrl(h: Harness, parameters: Record<string, string>): string {
  return `/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    code_challenge_method: "S256",
    redirect_uri: REDIRECT,
    resource: `${h.origin}${SECRET}`,
    state: "client-state",
    ...parameters,
  })}`;
}

/**
 * What a person's browser does with an authorization URL: follows it to the consent page, and
 * sends the person's answer. Answers with where the browser is sent then.
 */
async function consent(h: Harness, url: string, cookie: string, approve = true): Promise<URL> {
  const started = await h.request(url, { headers: { cookie } });
  expect(started.status).toBe(302);
  const page = new URL(started.headers.get("location") ?? "", h.origin);
  expect(page.pathname).toBe("/oauth/consent");
  const decided = await h.request(
    "/api/v1/oauth/decision",
    json({ request: page.searchParams.get("request"), approve }, { cookie, origin: h.origin }),
  );
  expect(decided.status).toBe(200);
  return new URL(((await decided.json()) as { redirect: string }).redirect);
}

/** Registers a client, has a person approve it, and exchanges the code: tokens for an address. */
async function authorize(h: Harness, person: string, address = SECRET) {
  const { client } = await register(h);
  const { verifier, challenge } = pkce();
  const back = await consent(
    h,
    authorizeUrl(h, {
      client_id: client.client_id ?? "",
      code_challenge: challenge,
      resource: `${h.origin}${address}`,
    }),
    await h.signIn(person),
  );
  const response = await h.request(
    "/oauth/token",
    form({
      grant_type: "authorization_code",
      client_id: client.client_id ?? "",
      code: back.searchParams.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: `${h.origin}${address}`,
    }),
  );
  expect(response.status).toBe(200);
  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
  return { clientId: client.client_id ?? "", tokens };
}

const mcp = (h: Harness, address: string, token?: string) =>
  h.request(address, {
    method: "POST",
    headers: {
      ...MCP_HEADERS,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: LIST_TOOLS,
  });

describe("what a client is told about asking for access", () => {
  it("publishes the authorization server's metadata where its issuer says, and not at the root", async () => {
    const h = harness();
    // The issuer has a path, so its metadata is found from the issuer and from nowhere else:
    // by the rule of RFC 8414, and under the issuer itself, where some clients look.
    const response = await h.request("/.well-known/oauth-authorization-server/oauth");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await (await h.request("/oauth/.well-known/oauth-authorization-server")).json()).toEqual(
      await response.clone().json(),
    );
    // Nothing at the root of the origin: a client that looks there from an address would take
    // every address, the public ones too, for a server that wants a sign-in.
    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
      "/.well-known/oauth-protected-resource",
    ]) {
      expect((await h.request(path)).status, path).toBe(404);
    }
    expect(await response.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${SIGN_IN_URL}/oauth/authorize`,
      token_endpoint: `${SIGN_IN_URL}/oauth/token`,
      registration_endpoint: `${SIGN_IN_URL}/oauth/register`,
      revocation_endpoint: `${SIGN_IN_URL}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: [
        "none",
        "client_secret_post",
        "client_secret_basic",
      ],
      scopes_supported: ["read"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("describes an address that is not public as a protected resource, spelled as the client spelled it", async () => {
    const h = harness({ host: createFixtureHost("oauth-resource") });
    // A private repository and a name that is nothing: one document, for both alike.
    for (const path of ["/gh/acme/secret-skills", "/gh/Acme/No-Such-Repo@v1/docs"]) {
      const response = await h.request(`/.well-known/oauth-protected-resource${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        resource: `${SIGN_IN_URL}${path}`,
        authorization_servers: [ISSUER],
        scopes_supported: ["read"],
        bearer_methods_supported: ["header"],
      });
    }
    for (const path of ["", "/gh/acme", "/gh/acme/skills.git", "/gh/acme/skills@"]) {
      const response = await h.request(`/.well-known/oauth-protected-resource${path}`);
      expect(response.status, path).toBe(404);
    }
    // When the git host cannot say what a name is, neither can this: nothing is claimed.
    const down = createFixtureHost("oauth-resource-down");
    down.fail("getRepository");
    const unknown = await harness({ host: down }).request(
      "/.well-known/oauth-protected-resource/gh/acme/licensed",
    );
    expect(unknown.status).toBe(503);
  });

  it("shows no sign of signing in at an address that needs none", async () => {
    const host = createFixtureHost("oauth-open");
    const h = harness({ host });
    // What a client finds when it looks for a way to sign in before it connects, as some do:
    // nothing, at every place the conventions name for the address. To such a client a public
    // address is what it is on a deployment where nobody signs in.
    for (const path of [
      "/.well-known/oauth-protected-resource/gh/acme/multi-skill",
      "/.well-known/oauth-protected-resource/gh/acme/multi-skill@main/skills",
      "/.well-known/oauth-authorization-server/gh/acme/multi-skill",
      "/.well-known/openid-configuration/gh/acme/multi-skill",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
    ]) {
      const response = await h.request(path);
      expect(response.status, path).toBe(404);
    }
    const absent = await h.request("/.well-known/oauth-protected-resource/gh/acme/multi-skill");
    expect(absent.headers.get("cache-control")).toBe("no-store");
    // Looking for the document reads nothing of the repository, and indexes nothing.
    expect(host.calls.resolveRef + host.calls.getTree).toBe(0);
    // Under the address itself there is the address, never a document about signing in.
    for (const path of [
      "/gh/acme/multi-skill/.well-known/oauth-protected-resource",
      "/gh/acme/multi-skill/.well-known/openid-configuration",
    ]) {
      const response = await h.request(path, { headers: { accept: "application/json" } });
      expect(response.status, path).not.toBe(200);
      expect(response.headers.get("www-authenticate"), path).toBeNull();
    }

    // And it never asks for a credential, whatever it is sent: one that is no good is not
    // needed either.
    for (const credential of [undefined, "scdn_at_made-up"]) {
      const served = await mcp(h, "/gh/acme/multi-skill", credential);
      expect(served.status, String(credential)).toBe(200);
      expect(served.headers.get("www-authenticate")).toBeNull();
    }
  });

  it("challenges nobody in particular the same way for a private repository and for nothing", async () => {
    const host = createFixtureHost("oauth-challenge");
    const h = harness({ host });
    const hidden = await mcp(h, SECRET);
    const missing = await mcp(h, "/gh/acme/no-such-repo");
    for (const [response, path] of [
      [hidden, SECRET],
      [missing, "/gh/acme/no-such-repo"],
    ] as const) {
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${SIGN_IN_URL}/.well-known/oauth-protected-resource${path}", scope="read"`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-expose-headers")).toContain("www-authenticate");
    }
    expect(await hidden.json()).toEqual(await missing.json());
    expect(host.asked.some((call) => call.credential === "installation")).toBe(false);
  });

  it("serves a public repository to a client without a token, as it always did", async () => {
    const h = harness();
    const client = await h.connect("/gh/acme/multi-skill");
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("load_skill");
    await client.close();
  });

  it("answers 404 instead of a challenge where nobody can sign in", async () => {
    const h = createHarness(testDatabase);
    const response = await mcp(h, SECRET);
    expect(response.status).toBe(404);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});

describe("a client asking a person for access", () => {
  it("registers itself, and is refused where a person could be sent somewhere unsafe", async () => {
    const h = harness();
    const { response, client } = await register(h);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(client).toMatchObject({
      client_id: expect.stringMatching(/^scdn_client_/),
      client_name: "Test client",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(client.client_secret).toBeUndefined();

    for (const redirect of [
      "http://example.com/callback",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://example.com/callback#fragment",
      "https://user:pass@example.com/callback",
      "not a uri",
    ]) {
      const refused = await register(h, { redirect_uris: [redirect] });
      expect(refused.response.status, redirect).toBe(400);
      expect(refused.client.error, redirect).toBe("invalid_redirect_uri");
    }
    for (const metadata of [
      { redirect_uris: [] },
      { token_endpoint_auth_method: "private_key_jwt" },
      { grant_types: ["client_credentials"] },
      { response_types: ["token"] },
    ]) {
      const refused = await register(h, metadata);
      expect(refused.response.status).toBe(400);
    }
    // An app's own scheme and an https page are where clients really are.
    for (const redirect of ["cursor://anysphere.cursor/oauth/callback", "https://claude.ai/cb"]) {
      expect((await register(h, { redirect_uris: [redirect] })).response.status).toBe(201);
    }
  });

  it("shows a name that is fit to show, whatever a client calls itself", async () => {
    const h = harness();
    const hostile = `Trusted${String.fromCodePoint(0x202e)}tneilC`;
    expect((await register(h, { client_name: hostile })).client.client_name).toBe("Unnamed client");
    expect((await register(h, { client_name: "  A\n\tB  " })).client.client_name).toBe("A B");
    expect((await register(h, { client_name: "x".repeat(300) })).client.client_name).toHaveLength(
      80,
    );
  });

  it("never sends a person to a redirect URI the client did not register", async () => {
    const h = harness();
    const { client } = await register(h);
    const { challenge } = pkce();
    const unknown = await h.request(
      authorizeUrl(h, { client_id: "scdn_client_nobody", code_challenge: challenge }),
    );
    expect(unknown.headers.get("location")).toBe("/oauth/consent?error=invalid_client");
    const elsewhere = await h.request(
      authorizeUrl(h, {
        client_id: client.client_id ?? "",
        code_challenge: challenge,
        redirect_uri: "https://evil.test/callback",
      }),
    );
    expect(elsewhere.headers.get("location")).toBe("/oauth/consent?error=invalid_redirect_uri");
    // A client on this computer learns its port when it starts listening: the port may differ.
    const otherPort = await h.request(
      authorizeUrl(h, {
        client_id: client.client_id ?? "",
        code_challenge: challenge,
        redirect_uri: "http://127.0.0.1:5999/callback",
      }),
    );
    expect(otherPort.headers.get("location")).toMatch(/^\/oauth\/consent\?request=/);
  });

  it("sends nobody to a client because a request was wrong: anyone can register one", async () => {
    const h = harness();
    // A client anyone could have registered, with a redirect URI of its author's choosing.
    const elsewhere = "https://elsewhere.test/landing";
    const { client } = await register(h, { redirect_uris: [elsewhere] });
    const { challenge } = pkce();
    const base = {
      client_id: client.client_id ?? "",
      code_challenge: challenge,
      redirect_uri: elsewhere,
    };
    for (const [parameters, error] of [
      [{ ...base, response_type: "token" }, "unsupported_response_type"],
      [{ ...base, code_challenge: "" }, "invalid_request"],
      [{ ...base, code_challenge_method: "plain" }, "invalid_request"],
      [{ ...base, state: "s".repeat(2000) }, "invalid_request"],
      [{ ...base, resource: "https://elsewhere.test/gh/acme/secret-skills" }, "invalid_target"],
      [{ ...base, resource: `${SIGN_IN_URL}/gh/acme` }, "invalid_target"],
      [{ ...base, resource: `${SIGN_IN_URL}/gh/acme/x?y=1` }, "invalid_target"],
    ] as const) {
      const response = await h.request(authorizeUrl(h, parameters));
      expect(response.status).toBe(302);
      // What is wrong is shown on a page of this deployment. The browser goes nowhere else.
      expect(response.headers.get("location"), error).toBe(`/oauth/consent?error=${error}`);
    }
    const missing = new URLSearchParams(authorizeUrl(h, base).slice("/oauth/authorize?".length));
    missing.delete("resource");
    expect((await h.request(`/oauth/authorize?${missing}`)).headers.get("location")).toBe(
      "/oauth/consent?error=invalid_target",
    );
    // The link an attacker would hand out: this deployment's name, and their client behind it.
    const bare = await h.request(`/oauth/authorize?client_id=${client.client_id}`);
    expect(bare.headers.get("location")).toBe("/oauth/consent?error=unsupported_response_type");
  });

  it("stores only so many clients that nobody has used, and says when to try again", async () => {
    // The tests of this file share a database, so the bound is whatever is there plus two.
    const counting = harness({ maxUnusedClients: Number.MAX_SAFE_INTEGER });
    const before = (await register(counting)).response;
    expect(before.status).toBe(201);
    const unused = await countUnusedOAuthClients(testDatabase.database);

    const h = harness({ maxUnusedClients: unused + 2 });
    expect((await register(h)).response.status).toBe(201);
    expect((await register(h)).response.status).toBe(201);
    const refused = await register(h);
    expect(refused.response.status).toBe(503);
    expect(refused.response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(refused.client).toMatchObject({ error: "temporarily_unavailable" });
    // Neither is a metadata document that was never seen before, and it is not even fetched.
    let fetched = 0;
    const withDocuments = harness({
      maxUnusedClients: unused + 2,
      fetchClientDocument: async (url) => {
        fetched += 1;
        return {
          body: { client_id: url.href, redirect_uris: ["https://client.example/callback"] },
          maxAgeMs: undefined,
        };
      },
    });
    const unseen = await withDocuments.request(
      authorizeUrl(withDocuments, {
        client_id: "https://client.example/too-many/client.json",
        code_challenge: pkce().challenge,
        redirect_uri: "https://client.example/callback",
      }),
    );
    expect(fetched).toBe(0);
    expect(unseen.headers.get("location")).toBe("/oauth/consent?error=invalid_client");
  });

  it("shows the consent page who asks, for what, where the answer goes, and whether it will work", async () => {
    const h = harness();
    const { client } = await register(h, { client_uri: "https://client.example/about" });
    const { challenge } = pkce();
    const started = await h.request(
      authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: challenge }),
    );
    const sealed = new URL(started.headers.get("location") ?? "", h.origin).searchParams.get(
      "request",
    );
    const path = `/api/v1/oauth/request?request=${encodeURIComponent(sealed ?? "")}`;

    const anonymous = restAuthorizationSchema.parse(await (await h.request(path)).json());
    expect(anonymous).toEqual({
      client: {
        name: "Test client",
        uri: "https://client.example/about",
        redirectHost: "127.0.0.1:43110",
        loopback: true,
      },
      address: "/gh/acme/secret-skills",
      scope: ["read"],
      user: null,
      visible: null,
      installUrl: null,
    });
    const alice = restAuthorizationSchema.parse(
      await (await h.request(path, { headers: { cookie: await h.signIn("alice") } })).json(),
    );
    expect(alice).toMatchObject({ user: { login: "Alice" }, visible: true });
    const carol = restAuthorizationSchema.parse(
      await (await h.request(path, { headers: { cookie: await h.signIn("carol") } })).json(),
    );
    expect(carol).toMatchObject({
      user: { login: "carol" },
      visible: false,
      installUrl: FIXTURE_INSTALL_URL,
    });

    const tampered = await h.request(`${path.slice(0, -4)}AAAA`);
    expect(tampered.status).toBe(400);
    expect(await tampered.json()).toMatchObject({ error: { code: "oauth.invalid_request" } });

    // An app's own scheme leads to that app. What it writes after the scheme is not a host,
    // and the page is never told that the answer goes to a site of that name.
    const scheme = "com.evil.app://github.com/callback";
    const { client: native } = await register(h, {
      client_name: "A trusted name",
      redirect_uris: [scheme],
    });
    const begun = await h.request(
      authorizeUrl(h, {
        client_id: native.client_id ?? "",
        code_challenge: challenge,
        redirect_uri: scheme,
      }),
    );
    const request = new URL(begun.headers.get("location") ?? "", h.origin).searchParams.get(
      "request",
    );
    const shown = restAuthorizationSchema.parse(
      await (
        await h.request(`/api/v1/oauth/request?request=${encodeURIComponent(request ?? "")}`)
      ).json(),
    );
    expect(shown.client).toMatchObject({ redirectHost: "com.evil.app:", loopback: true });
    expect(JSON.stringify(shown)).not.toContain("github.com");
  });

  it("takes an answer only from a signed-in person on its own pages", async () => {
    const h = harness();
    const { client } = await register(h);
    const { challenge } = pkce();
    const started = await h.request(
      authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: challenge }),
    );
    const request = new URL(started.headers.get("location") ?? "", h.origin).searchParams.get(
      "request",
    );
    const cookie = await h.signIn("alice");
    const body = { request, approve: true };
    expect(
      (await h.request("/api/v1/oauth/decision", json(body, { origin: h.origin }))).status,
    ).toBe(401);
    expect(
      (
        await h.request(
          "/api/v1/oauth/decision",
          json(body, { cookie, origin: "https://evil.test" }),
        )
      ).status,
    ).toBe(403);
    expect((await h.request("/api/v1/oauth/decision", json(body, { cookie }))).status).toBe(403);

    const declined = await consent(
      h,
      authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: challenge }),
      cookie,
      false,
    );
    expect(declined.searchParams.get("error")).toBe("access_denied");
    expect(declined.searchParams.get("code")).toBeNull();
    expect(declined.searchParams.get("state")).toBe("client-state");
    expect(declined.searchParams.get("iss")).toBe(ISSUER);
  });

  it("forgets a request the person took too long over", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const { client } = await register(h);
    const started = await h.request(
      authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: pkce().challenge }),
    );
    const request = new URL(started.headers.get("location") ?? "", h.origin).searchParams.get(
      "request",
    );
    const cookie = await h.signIn("alice");
    clock.advance(11 * 60_000);
    const late = await h.request(
      "/api/v1/oauth/decision",
      json({ request, approve: true }, { cookie, origin: h.origin }),
    );
    expect(late.status).toBe(400);
    expect(await late.json()).toMatchObject({ error: { code: "oauth.invalid_request" } });
  });
});

describe("tokens", () => {
  it("exchanges a code once, for the client it was issued to, with the verifier of its challenge", async () => {
    const h = harness();
    const { client } = await register(h);
    const other = await register(h);
    const cookie = await h.signIn("alice");
    const exchange = async (fields: Record<string, string>) => {
      const { verifier, challenge } = pkce();
      const back = await consent(
        h,
        authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: challenge }),
        cookie,
      );
      expect(back.searchParams.get("iss")).toBe(ISSUER);
      expect(back.searchParams.get("state")).toBe("client-state");
      const code = back.searchParams.get("code") ?? "";
      const fieldsOf = {
        grant_type: "authorization_code",
        client_id: client.client_id ?? "",
        code,
        code_verifier: verifier,
        ...fields,
      };
      return { code, verifier, response: await h.request("/oauth/token", form(fieldsOf)) };
    };

    for (const [fields, error] of [
      [{ code_verifier: pkce().verifier }, "invalid_grant"],
      [{ client_id: other.client.client_id ?? "" }, "invalid_grant"],
      [{ redirect_uri: "http://127.0.0.1:43110/other" }, "invalid_grant"],
      [{ resource: `${SIGN_IN_URL}/gh/acme/other-secrets` }, "invalid_target"],
      [{ client_id: "scdn_client_nobody" }, "invalid_client"],
      [{ grant_type: "password" }, "unsupported_grant_type"],
    ] as const) {
      const { response } = await exchange(fields);
      expect(response.status, error).toBe(error === "invalid_client" ? 401 : 400);
      expect(((await response.json()) as { error: string }).error).toBe(error);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    const { code, verifier, response } = await exchange({});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      access_token: expect.stringMatching(/^scdn_at_/),
      refresh_token: expect.stringMatching(/^scdn_rt_/),
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read",
    });
    const again = await h.request(
      "/oauth/token",
      form({
        grant_type: "authorization_code",
        client_id: client.client_id ?? "",
        code,
        code_verifier: verifier,
      }),
    );
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("does not exchange a code the client was slow to bring", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const { client } = await register(h);
    const { verifier, challenge } = pkce();
    const back = await consent(
      h,
      authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: challenge }),
      await h.signIn("alice"),
    );
    clock.advance(61_000);
    const response = await h.request(
      "/oauth/token",
      form({
        grant_type: "authorization_code",
        client_id: client.client_id ?? "",
        code: back.searchParams.get("code") ?? "",
        code_verifier: verifier,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("opens the one address a token was issued for, to the person who allowed it, and nothing else", async () => {
    const host = createFixtureHost("oauth-token");
    const h = harness({ host });
    const { tokens } = await authorize(h, "alice");
    const served = await mcp(h, SECRET, tokens.access_token);
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("no-store");

    // Another repository the same person can see and another path of the same repository are
    // other addresses: the token is not for them.
    for (const address of ["/gh/acme/other-secrets", `${SECRET}/skills`]) {
      const refused = await mcp(h, address, tokens.access_token);
      expect(refused.status, address).toBe(401);
      expect(refused.headers.get("www-authenticate"), address).toContain('error="invalid_token"');
    }
    // It is not for a public address either, which is served all the same: what everyone may
    // read needs no credential, so one that is no good there is nothing to refuse.
    expect((await mcp(h, "/gh/acme/multi-skill", tokens.access_token)).status).toBe(200);
    for (const credential of ["Bearer scdn_at_made-up", "Basic dXNlcjpwYXNz", "Bearer"]) {
      const refused = await h.request(SECRET, {
        method: "POST",
        headers: { ...MCP_HEADERS, authorization: credential },
        body: LIST_TOOLS,
      });
      expect(refused.status, credential).toBe(401);
      expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
    // The same spelling rules as the address itself: the owner's case does not make another one.
    expect((await mcp(h, "/gh/Acme/Secret-Skills", tokens.access_token)).status).toBe(200);
    expect(JSON.stringify(h.logs)).not.toContain(tokens.access_token);
  });

  it("stops opening an address when the person no longer can, whatever the token says", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, permissionTtlMs: 0 });
    const { tokens } = await authorize(h, "bob");
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(200);
    const bob = login.people.bob;
    if (bob !== undefined) bob.sees.length = 0;
    const gone = await mcp(h, SECRET, tokens.access_token);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "mount.repo_not_found" } });

    // And when the git host no longer accepts the person at all, the client is told to ask again.
    const alice = await authorize(h, "alice");
    login.revoke("alice");
    const refused = await mcp(h, SECRET, alice.tokens.access_token);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("expires an access token and renews it with a refresh token that is good once", async () => {
    const clock = movableClock();
    const h = harness({ clock });
    const { clientId, tokens } = await authorize(h, "alice");
    clock.advance(3_601_000);
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(401);

    const refresh = (token: string, client = clientId) =>
      h.request(
        "/oauth/token",
        form({ grant_type: "refresh_token", client_id: client, refresh_token: token }),
      );
    const other = await register(h);
    expect((await refresh(tokens.refresh_token, other.client.client_id)).status).toBe(400);

    const renewed = await refresh(tokens.refresh_token);
    expect(renewed.status).toBe(200);
    const next = (await renewed.json()) as typeof tokens;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(h, SECRET, next.access_token)).status).toBe(200);

    // A client that did not get the answer asks again within the minute, and is given a pair.
    clock.advance(30_000);
    const retried = await refresh(tokens.refresh_token);
    expect(retried.status).toBe(200);
    const parallel = (await retried.json()) as typeof tokens;
    expect((await mcp(h, SECRET, parallel.access_token)).status).toBe(200);

    // Later, the same token again is somebody else holding it: everything under the grant goes.
    clock.advance(120_000);
    const reused = await refresh(tokens.refresh_token);
    expect(reused.status).toBe(400);
    expect(((await reused.json()) as { error: string }).error).toBe("invalid_grant");
    expect((await mcp(h, SECRET, next.access_token)).status).toBe(401);
    expect((await refresh(next.refresh_token)).status).toBe(400);
  });

  it("lets a person see what they allowed and take it back", async () => {
    const h = harness();
    const { tokens } = await authorize(h, "alice");
    const cookie = await h.signIn("alice");
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(200);
    expect((await h.request("/api/v1/me/grants")).status).toBe(401);
    const listed = restGrantsSchema.parse(
      await (await h.request("/api/v1/me/grants", { headers: { cookie } })).json(),
    );
    const [grant] = listed.items;
    expect(grant).toMatchObject({
      client: { name: "Test client", uri: null },
      address: "/gh/acme/secret-skills",
    });
    expect(grant?.lastUsedAt).not.toBeNull();

    const path = `/api/v1/me/grants/${grant?.id}`;
    const others = await h.signIn("bob");
    expect(
      (await h.request(path, { method: "DELETE", headers: { cookie: others, origin: h.origin } }))
        .status,
    ).toBe(404);
    expect((await h.request(path, { method: "DELETE", headers: { cookie } })).status).toBe(403);
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(200);
    const removed = await h.request(path, {
      method: "DELETE",
      headers: { cookie, origin: h.origin },
    });
    expect(removed.status).toBe(200);
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(401);
  });

  it("revokes a grant when the client that holds its token says so", async () => {
    const h = harness();
    const { clientId, tokens } = await authorize(h, "alice");
    const other = await register(h);
    const revoke = (client: string) =>
      h.request("/oauth/revoke", form({ client_id: client, token: tokens.refresh_token }));
    expect((await revoke(other.client.client_id ?? "")).status).toBe(200);
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(200);
    expect((await revoke(clientId)).status).toBe(200);
    expect((await mcp(h, SECRET, tokens.access_token)).status).toBe(401);
  });

  it("asks a client that registered with a secret to prove it holds it", async () => {
    const h = harness();
    const { client } = await register(h, { token_endpoint_auth_method: "client_secret_post" });
    expect(client.client_secret).toMatch(/^scdn_cs_/);
    const { verifier, challenge } = pkce();
    const cookie = await h.signIn("alice");
    const codeOf = async () =>
      (
        await consent(
          h,
          authorizeUrl(h, { client_id: client.client_id ?? "", code_challenge: challenge }),
          cookie,
        )
      ).searchParams.get("code") ?? "";
    const fields = {
      grant_type: "authorization_code",
      client_id: client.client_id ?? "",
      code_verifier: verifier,
    };
    const without = await h.request("/oauth/token", form({ ...fields, code: await codeOf() }));
    expect(without.status).toBe(401);
    const wrong = await h.request(
      "/oauth/token",
      form({ ...fields, code: await codeOf(), client_secret: "scdn_cs_guess" }),
    );
    expect(wrong.status).toBe(401);
    const basic = await h.request("/oauth/token", {
      ...form({ grant_type: "authorization_code", code: await codeOf(), code_verifier: verifier }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`,
      },
    });
    expect(basic.status).toBe(200);
  });
});

describe("an address its person cannot open", () => {
  /** Starts an authorization for an address and has a person approve it: the server's answer. */
  const approve = async (h: Harness, clientId: string, address: string, cookie: string) => {
    const begun = await h.request(
      authorizeUrl(h, {
        client_id: clientId,
        code_challenge: pkce().challenge,
        resource: `${h.origin}${address}`,
      }),
    );
    const sealed =
      new URL(begun.headers.get("location") ?? "", h.origin).searchParams.get("request") ?? "";
    const answer = await h.request(
      "/api/v1/oauth/decision",
      json({ request: sealed, approve: true }, { cookie, origin: h.origin }),
    );
    return { sealed, answer };
  };

  it("is asked about like any other, and allowed nothing once its person is known", async () => {
    const login = createFixtureLogin();
    const h = harness({ login, host: createFixtureHost("oauth-not-visible") });
    const { client } = await register(h);
    const clientId = client.client_id ?? "";

    // Up to the sign-in a name that is nothing goes the way a private repository goes: the
    // same challenge, the same document, the same page. Only a person is told, and a person
    // who cannot open the address is told the same for somebody else's repository and for
    // nothing at all: no, and no code for the app.
    const carol = await h.signIn("carol");
    const hidden = await approve(h, clientId, SECRET, carol);
    const missing = await approve(h, clientId, "/gh/acme/no-such-repo", carol);
    expect(hidden.answer.status).toBe(403);
    expect(hidden.answer.headers.get("cache-control")).toContain("no-store");
    const refusal = await hidden.answer.json();
    expect(refusal).toEqual({
      error: { code: "oauth.not_visible", message: expect.any(String) },
    });
    expect(missing.answer.status).toBe(403);
    expect(await missing.answer.json()).toEqual(refusal);

    // What is left to them is to go back to the app, which is told no and not why: the same
    // answer a person gives who could have said yes.
    const declined = await h.request(
      "/api/v1/oauth/decision",
      json({ request: hidden.sealed, approve: false }, { cookie: carol, origin: h.origin }),
    );
    const back = new URL(((await declined.json()) as { redirect: string }).redirect);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("error_description")).toBe("The request was declined.");
    expect(back.searchParams.get("code")).toBeNull();

    // A person who can open it is asked and answers, as before.
    const allowed = await approve(h, clientId, SECRET, await h.signIn("alice"));
    expect(allowed.answer.status).toBe(200);
    expect(
      new URL(((await allowed.answer.json()) as { redirect: string }).redirect).searchParams.get(
        "code",
      ),
    ).toMatch(/^scdn_c_/);
  });

  it("is allowed nothing while the git host cannot say who may open it", async () => {
    const login = createFixtureLogin();
    // An answer is believed for no time at all here, so the host is asked for every one.
    const h = harness({ login, permissionTtlMs: 0 });
    const { client } = await register(h);
    const bob = await h.signIn("bob");
    login.unreachable(true);
    const unsure = await approve(h, client.client_id ?? "", SECRET, bob);
    expect(unsure.answer.status).toBe(503);
    expect(await unsure.answer.json()).toMatchObject({ error: { code: "mount.unavailable" } });
    // The request is still there once the host answers again.
    login.unreachable(false);
    const again = await h.request(
      "/api/v1/oauth/decision",
      json({ request: unsure.sealed, approve: true }, { cookie: bob, origin: h.origin }),
    );
    expect(again.status).toBe(200);
  });
});

describe("a client that identifies itself with a metadata document", () => {
  const CLIENT_ID = "https://client.example/oauth/client.json";
  const document = (patch: Record<string, unknown> = {}) => ({
    client_id: CLIENT_ID,
    client_name: "Document client",
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
    ...patch,
  });

  it("is known by its document, which is fetched once and kept for a while", async () => {
    let fetched = 0;
    const h = harness({
      fetchClientDocument: async (url) => {
        fetched += 1;
        expect(url.href).toBe(CLIENT_ID);
        return { body: document(), maxAgeMs: undefined };
      },
    });
    const { verifier, challenge } = pkce();
    const url = authorizeUrl(h, {
      client_id: CLIENT_ID,
      code_challenge: challenge,
      redirect_uri: "https://client.example/callback",
    });
    const back = await consent(h, url, await h.signIn("alice"));
    expect(`${back.origin}${back.pathname}`).toBe("https://client.example/callback");
    const response = await h.request(
      "/oauth/token",
      form({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: back.searchParams.get("code") ?? "",
        code_verifier: verifier,
      }),
    );
    expect(response.status).toBe(200);
    expect(fetched).toBe(1);
  });

  // What five apps published as their documents on 2026-10-04, as they were fetched: what the
  // server is handed when those apps ask, and so what has to read as a client here. They carry
  // fields this server has no use for and grant types it does not issue, three of them listen
  // on this computer at a port they only learn when they start, and one would rather prove itself
  // with a key of its own: it is a public client here, held to PKCE like the others.
  const PUBLISHED = [
    {
      app: "Claude",
      presented: "https://claude.ai/api/mcp/auth_callback",
      recipient: { redirectHost: "claude.ai", loopback: false },
      published: {
        client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
        client_name: "Claude",
        client_uri: "https://claude.ai",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: [
          "authorization_code",
          "refresh_token",
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        ],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    },
    {
      app: "Claude Code",
      presented: "http://localhost:53127/callback",
      recipient: { redirectHost: "localhost:53127", loopback: true },
      published: {
        client_id: "https://claude.ai/oauth/claude-code-client-metadata",
        client_name: "Claude Code",
        client_uri: "https://claude.ai",
        redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    },
    {
      app: "ChatGPT",
      presented: "https://chatgpt.com/connector_platform_oauth_redirect",
      recipient: { redirectHost: "chatgpt.com", loopback: false },
      published: {
        client_id: "https://chatgpt.com/oauth/client.json",
        client_uri: "https://chatgpt.com/",
        redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "ChatGPT",
        logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
        token_endpoint_auth_signing_alg: "RS256",
        jwks_uri: "https://chatgpt.com/oauth/jwks.json",
      },
    },
    {
      app: "Codex CLI",
      presented: "http://127.0.0.1:41733/callback",
      recipient: { redirectHost: "127.0.0.1:41733", loopback: true },
      published: {
        client_id: "https://chatgpt.com/oauth/codex/client.json",
        client_uri: "https://chatgpt.com/codex",
        application_type: "native",
        redirect_uris: ["http://127.0.0.1/callback", "http://localhost/callback"],
        token_endpoint_auth_method: "none",
        token_endpoint_auth_methods_supported: ["none"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Codex",
        logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
      },
    },
    {
      app: "VS Code",
      presented: "http://127.0.0.1:49731/",
      recipient: { redirectHost: "127.0.0.1:49731", loopback: true },
      published: {
        client_name: "Visual Studio Code",
        logo_uri: "https://code.visualstudio.com/assets/branding/code-stable.png",
        grant_types: [
          "authorization_code",
          "refresh_token",
          "urn:ietf:params:oauth:grant-type:device_code",
        ],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
        client_id: "https://vscode.dev/oauth/client-metadata.json",
        client_uri: "https://vscode.dev/product",
        redirect_uris: ["http://127.0.0.1:33418/", "https://vscode.dev/redirect"],
      },
    },
  ];

  it.each(PUBLISHED)(
    "reads the document $app publishes, and answers where the app listens",
    async ({ published, presented, recipient }) => {
      const h = harness({
        fetchClientDocument: async () => ({ body: published, maxAgeMs: 300_000 }),
      });
      const cookie = await h.signIn("alice");
      const { verifier, challenge } = pkce();
      const url = authorizeUrl(h, {
        client_id: published.client_id,
        code_challenge: challenge,
        redirect_uri: presented,
      });
      // The consent page names the app as it names itself, and who the answer really goes to.
      const begun = await h.request(url, { headers: { cookie } });
      const request = new URL(begun.headers.get("location") ?? "", h.origin).searchParams.get(
        "request",
      );
      const shown = restAuthorizationSchema.parse(
        await (
          await h.request(`/api/v1/oauth/request?request=${encodeURIComponent(request ?? "")}`)
        ).json(),
      );
      expect(shown.client).toMatchObject({ name: published.client_name, ...recipient });

      const back = await consent(h, url, cookie);
      expect(`${back.origin}${back.pathname}`).toBe(presented);
      // A public client: its id and the verifier, and nothing else to prove itself with.
      const response = await h.request(
        "/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: published.client_id,
          code: back.searchParams.get("code") ?? "",
          code_verifier: verifier,
          redirect_uri: presented,
          resource: `${h.origin}${SECRET}`,
        }),
      );
      expect(response.status).toBe(200);
    },
  );

  it.each([
    ["names another client", document({ client_id: "https://client.example/other.json" })],
    ["asks for a secret", document({ token_endpoint_auth_method: "client_secret_post" })],
    ["has an unsafe redirect URI", document({ redirect_uris: ["http://client.example/cb"] })],
    ["is not an object", "nothing"],
  ])("is nobody when its document %s", async (_, body) => {
    const id = `https://client.example/oauth/${randomBytes(6).toString("hex")}.json`;
    const h = harness({
      fetchClientDocument: async () => ({
        body:
          typeof body === "string"
            ? body
            : { ...body, client_id: body.client_id === CLIENT_ID ? id : body.client_id },
        maxAgeMs: undefined,
      }),
    });
    const response = await h.request(
      authorizeUrl(h, {
        client_id: id,
        code_challenge: pkce().challenge,
        redirect_uri: "https://client.example/callback",
      }),
    );
    expect(response.headers.get("location")).toBe("/oauth/consent?error=invalid_client");
  });

  it("is never fetched from a URL that is not a document's", async () => {
    let fetched = 0;
    const h = harness({
      fetchClientDocument: async () => {
        fetched += 1;
        return { body: document(), maxAgeMs: undefined };
      },
    });
    for (const id of [
      "http://client.example/client.json",
      "https://client.example/",
      "https://client.example:8443/client.json",
      "https://user@client.example/client.json",
      "https://client.example/a/../client.json",
      "https://client.example/client.json#x",
    ]) {
      const response = await h.request(
        authorizeUrl(h, { client_id: id, code_challenge: pkce().challenge }),
      );
      expect(response.headers.get("location"), id).toBe("/oauth/consent?error=invalid_client");
    }
    expect(fetched).toBe(0);
  });
});

describe("an MCP client that signs in", () => {
  /** What a client keeps between the steps of an authorization, in memory. */
  class Provider implements OAuthClientProvider {
    redirected: URL | undefined;
    #client: StoredOAuthClientInformation | undefined;
    #tokens: StoredOAuthTokens | undefined;
    #verifier = "";

    get redirectUrl(): string {
      return REDIRECT;
    }
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: "SDK client",
        redirect_uris: [REDIRECT],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    }
    clientInformation() {
      return this.#client;
    }
    saveClientInformation(information: StoredOAuthClientInformation) {
      this.#client = information;
    }
    tokens() {
      return this.#tokens;
    }
    saveTokens(tokens: StoredOAuthTokens) {
      this.#tokens = tokens;
    }
    redirectToAuthorization(url: URL) {
      this.redirected = url;
    }
    saveCodeVerifier(verifier: string) {
      this.#verifier = verifier;
    }
    codeVerifier() {
      return this.#verifier;
    }
  }

  it("discovers where to ask, registers, has the person agree, and reads the private repository", async () => {
    const h = harness({ host: createFixtureHost("oauth-sdk") });
    const provider = new Provider();
    const transportOf = () =>
      new StreamableHTTPClientTransport(new URL(`${h.origin}${SECRET}`), {
        authProvider: provider,
        fetch: async (input, init) => h.app.fetch(new Request(input, init)),
      });

    const first = transportOf();
    await expect(
      new Client({ name: "skillcdn-test", version: "0.0.0" }).connect(first),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    const opened = provider.redirected;
    expect(opened?.origin).toBe(SIGN_IN_URL);
    expect(opened?.pathname).toBe("/oauth/authorize");
    expect(opened?.searchParams.get("resource")).toBe(`${SIGN_IN_URL}${SECRET}`);
    expect(opened?.searchParams.get("code_challenge_method")).toBe("S256");

    const back = await consent(h, `${opened?.pathname}${opened?.search}`, await h.signIn("alice"));
    await first.finishAuth(back.searchParams);

    const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
    await client.connect(transportOf());
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["browse_repo", "search_repo", "load_skill", "read_repo_file"]),
    );
    const loaded = await client.callTool({
      name: "load_skill",
      arguments: { path: "skills/release-notes/SKILL.md" },
    });
    expect(textOf(loaded)).toContain("release-notes");
    await client.close();
  });
});
