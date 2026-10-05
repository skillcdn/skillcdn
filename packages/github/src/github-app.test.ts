import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { GitHostError, type RepoCoordinates } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { connectGitHub, createGitHubHost, type GitHubHostOptions } from "./github-host.js";
import { createGitHubLogin, githubWebUrl } from "./github-login.js";
import type { FetchLike } from "./http.js";

// The app's own endpoints cannot be recorded without a registered app, and a person's without
// a person: their replies are written here by hand, in the shape the host documents and trimmed
// to what the adapter reads. The account and repository replies are the recorded ones.

interface RecordedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const fixture: { readonly responses: Readonly<Record<string, RecordedResponse>> } = JSON.parse(
  readFileSync(new URL("../fixtures/api.json", import.meta.url), "utf8"),
);

const BASE_URL = "https://api.github.test";
const WEB_URL = "https://github.test";
const NOW = Date.parse("2026-10-01T00:00:00Z");
// Made here and thrown away: no key, however useless, is committed.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const secret: RepoCoordinates = {
  host: "gh",
  owner: "skillcdn",
  repo: "private-skills",
  credential: "installation",
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

interface Seen {
  readonly key: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

function replay(replies: Record<string, RecordedResponse | (() => RecordedResponse)>) {
  const seen: Seen[] = [];
  const fetchLike: FetchLike = async (input, init) => {
    const url = new URL(input);
    const key = `${init.method} ${url.origin === BASE_URL ? "" : url.origin}${url.pathname}${url.search}`;
    seen.push({
      key,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? init.body : undefined,
    });
    const found = replies[key] ?? fixture.responses[key];
    if (found === undefined) {
      throw new Error(`no reply for ${key}`);
    }
    const reply = typeof found === "function" ? found() : found;
    return new Response(reply.status === 204 ? null : reply.body, {
      status: reply.status,
      headers: reply.headers,
    });
  };
  return { fetchLike, seen };
}

const options = (fetchLike: FetchLike, now = () => NOW): GitHubHostOptions => ({
  baseUrl: BASE_URL,
  userAgent: "skillcdn-test",
  fetch: fetchLike,
  retryBaseDelayMs: 0,
  token: async () => "deployment-token",
  app: { appId: "424242", privateKey },
  now,
});

const INSTALLATION = "GET /repos/skillcdn/private-skills/installation";
const ISSUE = "POST /app/installations/77/access_tokens";
const REPOSITORY = "GET /repos/skillcdn/private-skills";
const repository = json(200, {
  id: 99,
  name: "private-skills",
  private: true,
  visibility: "private",
  default_branch: "main",
  description: "Only for us.",
  owner: { login: "skillcdn", id: 331879177, type: "Organization" },
});
const issued = (token: string, expiresAt: string) =>
  json(201, { token, expires_at: expiresAt, permissions: { contents: "read" } });

async function failureOf(promise: Promise<unknown>): Promise<GitHostError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitHostError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("a repository read through the app's installation", () => {
  it("proves the app is the app, is issued a token for the installation, and reads with it", async () => {
    const { fetchLike, seen } = replay({
      [INSTALLATION]: json(200, { id: 77, account: { login: "skillcdn" } }),
      [ISSUE]: issued("ghs_installation-token", "2026-10-01T01:00:00Z"),
      [REPOSITORY]: repository,
    });
    const found = await createGitHubHost(options(fetchLike)).getRepository(secret);
    expect(found).toMatchObject({ name: "private-skills", visibility: "private" });
    expect(seen.map((request) => request.key)).toEqual([INSTALLATION, ISSUE, REPOSITORY]);

    // The first two are asked as the app: a statement signed with its key, good for minutes.
    const proof = seen[0]?.headers.authorization?.replace("Bearer ", "") ?? "";
    const [head, claims, signature] = proof.split(".");
    expect(JSON.parse(Buffer.from(head ?? "", "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const stated = JSON.parse(Buffer.from(claims ?? "", "base64url").toString());
    expect(stated).toEqual({ iss: "424242", iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 });
    expect(
      createVerify("RSA-SHA256")
        .update(`${head}.${claims}`)
        .verify(keys.publicKey, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);
    expect(seen[1]?.headers.authorization).toBe(`Bearer ${proof}`);
    // The token asks for no more than reading, whatever the app was granted.
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({
      permissions: { contents: "read", metadata: "read" },
    });
    // The repository is read with the installation's token, never the deployment's.
    expect(seen[2]?.headers.authorization).toBe("Bearer ghs_installation-token");
  });

  it("keeps the installation and its token while they are good, and asks again after", async () => {
    let now = NOW;
    let tokens = 0;
    const { fetchLike, seen } = replay({
      [INSTALLATION]: json(200, { id: 77 }),
      [ISSUE]: () => {
        tokens += 1;
        return issued(`ghs_token-${tokens}`, new Date(now + 3_600_000).toISOString());
      },
      [REPOSITORY]: repository,
      "GET /repos/skillcdn/private-skills/commits/HEAD": {
        status: 200,
        headers: {},
        body: "0e169f0cf93f93478cf2634eb8082d4e933afde7",
      },
    });
    const github = createGitHubHost(options(fetchLike, () => now));
    await github.getRepository(secret);
    await github.resolveRef(secret, undefined);
    expect(seen.filter((request) => request.key === ISSUE)).toHaveLength(1);
    expect(seen.filter((request) => request.key === INSTALLATION)).toHaveLength(1);
    expect(seen.at(-1)?.headers.authorization).toBe("Bearer ghs_token-1");

    // Five minutes before the token ends it is no longer handed out.
    now += 56 * 60_000;
    await github.resolveRef(secret, undefined);
    expect(tokens).toBe(2);
    expect(seen.at(-1)?.headers.authorization).toBe("Bearer ghs_token-2");
    // Whether the app is still installed is asked again, as the answer is a minute old.
    expect(seen.filter((request) => request.key === INSTALLATION)).toHaveLength(2);
  });

  it("shares one token among requests that arrive together", async () => {
    const { fetchLike, seen } = replay({
      [INSTALLATION]: json(200, { id: 77 }),
      [ISSUE]: issued("ghs_shared", "2026-10-01T01:00:00Z"),
      [REPOSITORY]: repository,
    });
    const github = createGitHubHost(options(fetchLike));
    await Promise.all([github.getRepository(secret), github.getRepository(secret)]);
    expect(seen.filter((request) => request.key === ISSUE)).toHaveLength(1);
  });

  it.each([
    ["not installed", { [INSTALLATION]: json(404, { message: "Not Found" }) }],
    [
      "suspended",
      {
        [INSTALLATION]: json(200, { id: 77 }),
        [ISSUE]: json(403, { message: "This installation has been suspended" }),
      },
    ],
    [
      "not allowed to read",
      {
        [INSTALLATION]: json(200, { id: 77 }),
        [ISSUE]: json(422, { message: "The permissions requested are not granted" }),
      },
    ],
  ])(
    "is not found where the app is %s, like a repository that does not exist",
    async (_, replies) => {
      const { fetchLike } = replay(replies);
      const error = await failureOf(createGitHubHost(options(fetchLike)).getRepository(secret));
      expect(error.kind).toBe("not_found");
      expect(error.message).toBe("not found on the git host");
    },
  );

  it("is not found on a deployment without an app", async () => {
    const { fetchLike, seen } = replay({});
    const { app: _app, ...withoutApp } = options(fetchLike);
    const error = await failureOf(createGitHubHost(withoutApp).getRepository(secret));
    expect(error.kind).toBe("not_found");
    expect(seen).toEqual([]);
  });

  it("remembers that the app is not installed, instead of asking for every request", async () => {
    const { fetchLike, seen } = replay({ [INSTALLATION]: json(404, { message: "Not Found" }) });
    const github = createGitHubHost(options(fetchLike));
    await failureOf(github.getRepository(secret));
    await failureOf(github.getRepository(secret));
    expect(seen).toHaveLength(1);
  });

  it("does not answer a private reply to the deployment's credential, or the reverse", async () => {
    const etag = '"private-etag"';
    const { fetchLike, seen } = replay({
      [INSTALLATION]: json(200, { id: 77 }),
      [ISSUE]: issued("ghs_token", "2026-10-01T01:00:00Z"),
      [REPOSITORY]: { ...repository, headers: { ...repository.headers, etag } },
    });
    const github = createGitHubHost(options(fetchLike));
    await github.getRepository(secret);
    // The same path asked as the deployment is another question, with nothing to revalidate.
    await github.getRepository({ ...secret, credential: "deployment" });
    const asDeployment = seen.at(-1);
    expect(asDeployment?.headers.authorization).toBe("Bearer deployment-token");
    expect(asDeployment?.headers["if-none-match"]).toBeUndefined();
    // Asked through the installation again, the stored reply is revalidated.
    await github.getRepository(secret);
    expect(seen.at(-1)?.headers["if-none-match"]).toBe(etag);
  });

  it("keeps the key, the proof and the token out of errors", async () => {
    const { fetchLike } = replay({
      [INSTALLATION]: json(200, { id: 77 }),
      [ISSUE]: issued("ghs_secret-token", "2026-10-01T01:00:00Z"),
      [REPOSITORY]: json(500, { message: "boom ghs_secret-token" }),
    });
    const error = await failureOf(
      createGitHubHost({ ...options(fetchLike), attempts: 1 }).getRepository(secret),
    );
    const said = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
    expect(said).not.toContain("ghs_secret-token");
    expect(said).not.toContain("PRIVATE KEY");
  });

  it("refuses a key that is not one when it is wired, not at the first private repository", () => {
    expect(() =>
      connectGitHub({ ...options(replay({}).fetchLike), app: { appId: "1", privateKey: "nope" } }),
    ).toThrow();
  });
});

describe("the directory of accounts", () => {
  const host = (fetchLike: FetchLike) => createGitHubHost(options(fetchLike));

  it("says who an account is from what the host tells everyone", async () => {
    const { fetchLike, seen } = replay({});
    expect(await host(fetchLike).getProfile("gh", "skillcdn")).toEqual({
      hostAccountId: "331879177",
      login: "skillcdn",
      kind: "organization",
      name: "SkillCDN",
      // The organization says nothing about itself, in either place it could.
      bio: undefined,
      publicRepositories: 2,
    });
    expect(seen.map((request) => request.key)).toEqual([
      "GET /users/skillcdn",
      "GET /orgs/skillcdn",
    ]);
    expect(seen[0]?.headers.authorization).toBe("Bearer deployment-token");
  });

  it("takes what an organization says about itself from where organizations say it", async () => {
    const { fetchLike } = replay({
      "GET /orgs/skillcdn": json(200, { description: "  Skills,\n everywhere.  " }),
    });
    expect((await host(fetchLike).getProfile("gh", "skillcdn")).bio).toBe("Skills, everywhere.");
    // A person's profile says it itself, and an organization that cannot be asked says nothing.
    const person = replay({
      "GET /users/someone": json(200, { id: 7, login: "someone", type: "User", bio: "Hello." }),
    });
    expect(await host(person.fetchLike).getProfile("gh", "someone")).toEqual({
      hostAccountId: "7",
      login: "someone",
      kind: "user",
      name: undefined,
      bio: "Hello.",
      publicRepositories: 0,
    });
    expect(person.seen).toHaveLength(1);
    const failing = replay({ "GET /orgs/skillcdn": json(500, {}) });
    const quiet = createGitHubHost({ ...options(failing.fetchLike), attempts: 1 });
    expect((await quiet.getProfile("gh", "skillcdn")).bio).toBeUndefined();
  });

  it("answers not found for an account that is not there", async () => {
    const { fetchLike } = replay({});
    const error = await failureOf(host(fetchLike).getProfile("gh", "skillcdn-no-such-account"));
    expect(error.kind).toBe("not_found");
  });

  it("lists an account's public repositories, most recently pushed first, a page at a time", async () => {
    const { fetchLike, seen } = replay({});
    const page = await host(fetchLike).listPublicRepositories("gh", "skillcdn", 1);
    expect(page.hasMore).toBe(false);
    expect(page.repositories.map((entry) => entry.name)).toEqual(["skills", "skillcdn"]);
    expect(page.repositories[1]).toEqual({
      hostRepoId: "1379202123",
      name: "skillcdn",
      description: undefined,
      fork: false,
      archived: false,
      stars: 0,
      pushedAt: expect.stringMatching(/^2026-\d\d-\d\dT[\d:.]+Z$/),
    });
    expect(seen[0]?.key).toBe(
      "GET /users/skillcdn/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=1",
    );
  });

  it("passes on only what the host reports as public, and says when there is more", async () => {
    const listing =
      "GET /users/acme/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=2";
    const { fetchLike } = replay({
      [listing]: json(
        200,
        [
          { id: 1, name: "open", private: false, visibility: "public", pushed_at: "not a date" },
          { id: 2, name: "closed", private: true, visibility: "private" },
          { id: 3, name: "inside", private: false, visibility: "internal" },
          {
            id: 4,
            name: "starred",
            private: false,
            stargazers_count: 12,
            fork: true,
            archived: true,
          },
        ],
        {
          link: '<https://api.github.test/x?page=3>; rel="next", <https://api.github.test/x?page=9>; rel="last"',
        },
      ),
    });
    const page = await host(fetchLike).listPublicRepositories("gh", "acme", 2);
    expect(page.hasMore).toBe(true);
    expect(page.repositories).toEqual([
      {
        hostRepoId: "1",
        name: "open",
        description: undefined,
        fork: false,
        archived: false,
        stars: 0,
        pushedAt: undefined,
      },
      {
        hostRepoId: "4",
        name: "starred",
        description: undefined,
        fork: true,
        archived: true,
        stars: 12,
        pushedAt: undefined,
      },
    ]);
    for (const bad of [0, -1, 1.5, 101, Number.NaN]) {
      expect(
        (await failureOf(host(fetchLike).listPublicRepositories("gh", "acme", bad))).kind,
      ).toBe("invalid");
    }
  });
});

describe("signing in", () => {
  const TOKEN = `POST ${WEB_URL}/login/oauth/access_token`;
  const login = (fetchLike: FetchLike, patch: Partial<GitHubHostOptions> = {}) => {
    const all = { ...options(fetchLike), ...patch };
    return createGitHubLogin(
      { ...all, webUrl: WEB_URL, clientId: "Iv23client", clientSecret: "client-secret" },
      connectGitHub(all),
    );
  };

  it("knows where people use the host from where its API is", () => {
    expect(githubWebUrl()).toBe("https://github.com");
    expect(githubWebUrl("https://api.github.com")).toBe("https://github.com");
    expect(githubWebUrl("https://api.tenant.ghe.com")).toBe("https://tenant.ghe.com");
    expect(githubWebUrl("https://github.example.test/api/v3")).toBe("https://github.example.test");
    expect(githubWebUrl("http://localhost:8080/api/v3")).toBe("http://localhost:8080");
  });

  it("sends people to the host with a state and a challenge", () => {
    const url = new URL(
      login(replay({}).fetchLike).authorizationUrl({
        state: "the-state",
        redirectUri: "https://skills.example/auth/gh/callback",
        codeChallenge: "the-challenge",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(`${WEB_URL}/login/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv23client",
      redirect_uri: "https://skills.example/auth/gh/callback",
      state: "the-state",
      code_challenge: "the-challenge",
      code_challenge_method: "S256",
    });
  });

  it("asks for the host's account picker for someone who wants another account", () => {
    const sent = (chooseAccount: boolean) =>
      new URL(
        login(replay({}).fetchLike).authorizationUrl({
          state: "the-state",
          redirectUri: "https://skills.example/auth/gh/callback",
          codeChallenge: "the-challenge",
          chooseAccount,
        }),
      ).searchParams;
    expect(sent(true).get("prompt")).toBe("select_account");
    expect(sent(true).get("state")).toBe("the-state");
    expect(sent(false).has("prompt")).toBe(false);
  });

  it("exchanges the code for the credential, with the verifier and the app's secret", async () => {
    const { fetchLike, seen } = replay({
      [TOKEN]: json(200, {
        access_token: "ghu_access",
        expires_in: 28_800,
        refresh_token: "ghr_refresh",
        refresh_token_expires_in: 15_897_600,
        token_type: "bearer",
        scope: "",
      }),
    });
    const credentials = await login(fetchLike).exchangeCode({
      code: "the-code",
      redirectUri: "https://skills.example/auth/gh/callback",
      codeVerifier: "the-verifier",
    });
    expect(credentials).toEqual({
      accessToken: "ghu_access",
      accessExpiresAt: new Date(NOW + 28_800_000),
      refreshToken: "ghr_refresh",
      refreshExpiresAt: new Date(NOW + 15_897_600_000),
    });
    expect(seen[0]?.headers.accept).toBe("application/json");
    expect(Object.fromEntries(new URLSearchParams(seen[0]?.body))).toEqual({
      client_id: "Iv23client",
      client_secret: "client-secret",
      code: "the-code",
      redirect_uri: "https://skills.example/auth/gh/callback",
      code_verifier: "the-verifier",
    });
    // Sent to where people sign in, and without any other credential.
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  it("takes a credential that does not expire as one, and renews one that does", async () => {
    const plain = replay({
      [TOKEN]: json(200, { access_token: "ghu_forever", token_type: "bearer" }),
    });
    expect(
      await login(plain.fetchLike).exchangeCode({ code: "c", redirectUri: "r", codeVerifier: "v" }),
    ).toEqual({
      accessToken: "ghu_forever",
      accessExpiresAt: undefined,
      refreshToken: undefined,
      refreshExpiresAt: undefined,
    });
    const renewing = replay({
      [TOKEN]: json(200, {
        access_token: "ghu_next",
        expires_in: 28_800,
        refresh_token: "ghr_next",
      }),
    });
    expect((await login(renewing.fetchLike).refresh("ghr_old")).accessToken).toBe("ghu_next");
    expect(Object.fromEntries(new URLSearchParams(renewing.seen[0]?.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "ghr_old",
    });
  });

  it.each([
    ["bad_verification_code", "unauthorized"],
    ["bad_refresh_token", "unauthorized"],
    ["incorrect_client_credentials", "invalid"],
    ["redirect_uri_mismatch", "invalid"],
  ] as const)("tells a refused %s apart from a misconfiguration", async (code, kind) => {
    // The host answers 200 with the error in the body.
    const { fetchLike } = replay({
      [TOKEN]: json(200, { error: code, error_description: "the code ghu_leak passed is wrong" }),
    });
    const error = await failureOf(login(fetchLike).refresh("ghr_secret"));
    expect(error.kind).toBe(kind);
    expect(error.message).toContain(code);
    expect(`${error.message} ${JSON.stringify(error)}`).not.toMatch(/ghu_leak|ghr_secret/);
  });

  it.each([
    [json(503, {}), "transient"],
    [json(429, {}), "rate_limited"],
    [json(400, { message: "no" }), "invalid"],
    [{ status: 200, headers: {}, body: "<html>not json</html>" }, "invalid"],
    [json(200, { token_type: "bearer" }), "invalid"],
  ] as const)("answers a token endpoint that misbehaves as what it is", async (reply, kind) => {
    const { fetchLike } = replay({ [TOKEN]: reply });
    expect((await failureOf(login(fetchLike).refresh("ghr_x"))).kind).toBe(kind);
  });

  it("asks who a person is, and what they can see, with their own credential", async () => {
    const { fetchLike, seen } = replay({
      "GET /user": json(200, { id: 1001, login: "octo", name: "Octo Cat", type: "User" }),
      "GET /repos/skillcdn/private-skills": json(200, { id: 99, private: true }),
      "GET /repos/skillcdn/elsewhere": json(404, { message: "Not Found" }),
      "GET /repos/skillcdn/sso": json(403, { message: "Resource protected by organization SAML" }),
    });
    const github = login(fetchLike);
    expect(await github.getUser("ghu_person")).toEqual({
      hostAccountId: "1001",
      login: "octo",
      name: "Octo Cat",
    });
    expect(await github.visibleRepository("ghu_person", secret)).toBe("99");
    // What they cannot see, and what the host will not show them now, are both nothing.
    expect(
      await github.visibleRepository("ghu_person", { ...secret, repo: "elsewhere" }),
    ).toBeUndefined();
    expect(
      await github.visibleRepository("ghu_person", { ...secret, repo: "sso" }),
    ).toBeUndefined();
    expect(seen.every((request) => request.headers.authorization === "Bearer ghu_person")).toBe(
      true,
    );
    // A person's answers are never kept for the next one who asks.
    await github.visibleRepository("ghu_other", secret);
    expect(seen.at(-1)?.headers["if-none-match"]).toBeUndefined();
  });

  it("tells a credential the host no longer accepts from a repository that is not there", async () => {
    const { fetchLike } = replay({
      "GET /repos/skillcdn/private-skills": json(401, { message: "Bad credentials" }),
      "GET /user": json(401, { message: "Bad credentials" }),
    });
    const github = login(fetchLike);
    expect((await failureOf(github.visibleRepository("ghu_dead", secret))).kind).toBe(
      "unauthorized",
    );
    expect((await failureOf(github.getUser("ghu_dead"))).kind).toBe("unauthorized");
    // The same status under the deployment's credential stays what it always was.
    const repositories = createGitHubHost(options(fetchLike));
    expect(
      (await failureOf(repositories.getRepository({ ...secret, credential: "deployment" }))).kind,
    ).toBe("not_found");
  });

  it("lists where a person can reach the app, and the repositories there", async () => {
    const { fetchLike } = replay({
      "GET /user/installations?per_page=30": json(200, {
        // More than the one page that is read.
        total_count: 31,
        installations: [
          {
            id: 7,
            account: { id: 331879177, login: "skillcdn", type: "Organization" },
            repository_selection: "selected",
            html_url: `${WEB_URL}/organizations/skillcdn/settings/installations/7`,
            suspended_at: null,
          },
          {
            id: 8,
            account: { id: 1001, login: "octo", type: "User" },
            repository_selection: "all",
            html_url: "https://elsewhere.test/settings/installations/8",
          },
          {
            id: 9,
            account: { id: 5, login: "paused", type: "Organization" },
            suspended_at: "2026-09-01T00:00:00Z",
          },
        ],
      }),
      "GET /user/installations/7/repositories?per_page=100": json(200, {
        total_count: 120,
        repositories: [
          {
            id: 99,
            name: "private-skills",
            private: true,
            description: "Only for us.",
            owner: { login: "skillcdn" },
          },
          {
            id: 98,
            name: "skills",
            private: false,
            visibility: "public",
            owner: { login: "skillcdn" },
          },
        ],
      }),
      "GET /user/installations/8/repositories?per_page=100": json(200, {
        total_count: 0,
        repositories: [],
      }),
    });
    expect(await login(fetchLike).listInstallations("ghu_person")).toEqual({
      installations: [
        {
          account: { hostAccountId: "331879177", login: "skillcdn", kind: "organization" },
          manageUrl: `${WEB_URL}/organizations/skillcdn/settings/installations/7`,
          selection: "selected",
          repositories: [
            {
              hostRepoId: "99",
              owner: "skillcdn",
              name: "private-skills",
              description: "Only for us.",
              visibility: "private",
            },
            {
              hostRepoId: "98",
              owner: "skillcdn",
              name: "skills",
              description: undefined,
              visibility: "public",
            },
          ],
          truncated: true,
        },
        {
          account: { hostAccountId: "1001", login: "octo", kind: "user" },
          // A link that leads anywhere but to the host is not passed on.
          manageUrl: undefined,
          selection: "all",
          repositories: [],
          truncated: false,
        },
      ],
      truncated: true,
    });
  });

  it("says where the app is added to repositories, when the host can be asked", async () => {
    const about = replay({
      "GET /app": json(200, { slug: "skillcdn", html_url: `${WEB_URL}/apps/skillcdn` }),
    });
    const github = login(about.fetchLike);
    expect(await github.installUrl()).toBe(`${WEB_URL}/apps/skillcdn/installations/new`);
    await github.installUrl();
    expect(about.seen).toHaveLength(1);
    expect(about.seen[0]?.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);

    const foreign = replay({
      "GET /app": json(200, { html_url: "https://elsewhere.test/apps/x" }),
    });
    expect(await login(foreign.fetchLike).installUrl()).toBeUndefined();
    const down = replay({ "GET /app": json(500, {}) });
    expect(await login(down.fetchLike, { attempts: 1 }).installUrl()).toBeUndefined();
    const { app: _app, ...withoutApp } = options(replay({}).fetchLike);
    expect(
      await createGitHubLogin(
        { ...withoutApp, webUrl: WEB_URL, clientId: "x", clientSecret: "y" },
        connectGitHub(withoutApp),
      ).installUrl(),
    ).toBeUndefined();
  });
});
