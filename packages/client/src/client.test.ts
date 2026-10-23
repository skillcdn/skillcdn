import { parseAddress, type RestMount, type RestSkill } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createClient, type FetchLike } from "./client.js";
import { skillPages, whenIndexed } from "./reads.js";

function address(input: string) {
  const parsed = parseAddress(input);
  if (!parsed.ok) throw new Error(`invalid test address ${input}`);
  return parsed.value;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const ready: RestMount = {
  address: "/gh/acme/skills",
  repository: {
    host: "gh",
    owner: "acme",
    name: "skills",
    defaultBranch: "main",
    description: null,
    avatar: "https://avatars.example/acme",
  },
  ref: null,
  pinned: false,
  commit: COMMIT,
  path: "",
  verified: false,
  image: null,
  index: {
    status: "ready",
    truncated: false,
    manifest: null,
    skillCount: 1,
    documentCount: 0,
    skills: [
      {
        name: "ads",
        path: "ads/SKILL.md",
        directory: "ads",
        description: "Ads.",
        warnings: [],
        translations: {},
      },
    ],
    documents: [],
    diagnostics: [],
  },
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(answers: (url: string, init: RequestInit) => Response | Promise<Response>): {
  readonly fetch: FetchLike;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answers(url, init);
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("createClient", () => {
  it("reads an address with the token as the bearer, never following a redirect", async () => {
    const { fetch, calls } = fakeFetch(() => json(ready));
    const client = createClient({
      baseUrl: "https://skillcdn.example/",
      fetch,
      token: "scdn_repo_secret",
      userAgent: "skillcdn-cli/1.0.0",
    });
    const mount = await client.mount(address("/gh/acme/skills"));
    expect(mount.commit).toBe(COMMIT);
    const [call] = calls;
    expect(call?.url).toBe("https://skillcdn.example/api/v1/mounts/gh/acme/skills");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer scdn_repo_secret");
    expect(headers["user-agent"]).toBe("skillcdn-cli/1.0.0");
    expect(headers.accept).toBe("application/json");
    expect(call?.init.redirect).toBe("error");
  });

  it("writes the query of each read as the API takes it", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.includes("/files/")
        ? json({
            kind: "file",
            path: "docs/a b.md",
            content: "",
            offset: 10,
            nextOffset: null,
            totalLength: 10,
          })
        : json({ status: "indexing" }),
    );
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    const at = address("/gh/acme/skills@v1/marketing");
    await client.browse(at, { path: "marketing/ads", limit: 5 });
    await client.find(at, { query: "release notes", cursor: "c" });
    await client.skill(at, { path: "marketing/ads/SKILL.md" });
    await client.file(at, { path: "docs/a b.md", offset: 10 });
    expect(calls.map((call) => call.url.slice("https://skillcdn.example".length))).toEqual([
      "/api/v1/browse/gh/acme/skills@v1/marketing?path=marketing%2Fads&limit=5",
      "/api/v1/find/gh/acme/skills@v1/marketing?query=release+notes&cursor=c",
      "/api/v1/skills/gh/acme/skills@v1/marketing?path=marketing%2Fads%2FSKILL.md",
      "/api/v1/files/gh/acme/skills@v1/marketing?path=docs%2Fa+b.md&offset=10",
    ]);
  });

  it("searches across every pack of the deployment at its route (ADR-0070)", async () => {
    const answer = {
      status: "ready",
      query: "release notes",
      packs: 2,
      items: [
        {
          address: "/gh/acme/skills",
          repository: "Acme/skills",
          item: {
            kind: "skill",
            name: "release-notes",
            path: "skills/release-notes/SKILL.md",
            directory: "skills/release-notes",
            description: "Writes the notes of a release.",
            translations: {},
            files: [],
            moreFiles: 0,
          },
        },
      ],
    };
    const { fetch, calls } = fakeFetch(() => json(answer));
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    expect(await client.search("release notes", 5)).toEqual(answer);
    await client.search("release notes");
    expect(calls.map((call) => call.url.slice("https://skillcdn.example".length))).toEqual([
      "/api/v1/search?query=release+notes&limit=5",
      "/api/v1/search?query=release+notes",
    ]);
  });

  it("turns an error answer into an ApiError with its code and what came with it", async () => {
    const { fetch } = fakeFetch((url) =>
      url.includes("/files/")
        ? json(
            {
              error: {
                code: "file.too_large",
                message: "Too large.",
                sourceUrl: "https://raw.example/big.pdf",
              },
            },
            413,
          )
        : json({ error: { code: "mount.rate_limited", message: "Later." } }, 503, {
            "retry-after": "7",
          }),
    );
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    const at = address("/gh/acme/skills");
    await expect(client.file(at, { path: "big.pdf" })).rejects.toMatchObject({
      status: 413,
      code: "file.too_large",
      sourceUrl: "https://raw.example/big.pdf",
    });
    await expect(client.mount(at)).rejects.toMatchObject({
      status: 503,
      code: "mount.rate_limited",
      retryAfterSeconds: 7,
    });
  });

  it("says when the server cannot be reached, answers unexpectedly, or answers too much", async () => {
    const down = createClient({
      baseUrl: "https://skillcdn.example",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(down.mount(address("/gh/acme/skills"))).rejects.toMatchObject({
      status: 0,
      code: "network",
    });
    const odd = createClient({
      baseUrl: "https://skillcdn.example",
      fetch: async () => json({ unexpected: true }),
    });
    await expect(odd.mount(address("/gh/acme/skills"))).rejects.toMatchObject({
      code: "invalid_response",
    });
    const large = createClient({
      baseUrl: "https://skillcdn.example",
      maxBodyBytes: 16,
      fetch: async () => json(ready),
    });
    await expect(large.mount(address("/gh/acme/skills"))).rejects.toMatchObject({
      code: "invalid_response",
    });
    const notJson = createClient({
      baseUrl: "https://skillcdn.example",
      fetch: async () => new Response("<html>", { status: 502 }),
    });
    await expect(notJson.mount(address("/gh/acme/skills"))).rejects.toMatchObject({
      status: 502,
      code: "invalid_response",
    });
  });

  it("gives up a request that takes too long", async () => {
    const slow = createClient({
      baseUrl: "https://skillcdn.example",
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    await expect(slow.mount(address("/gh/acme/skills"))).rejects.toMatchObject({
      code: "network",
      message: "The server did not answer in time.",
    });
  });
});

describe("whenIndexed and skillPages", () => {
  it("asks again while the commit is being indexed, and stops on a failure or in time", async () => {
    let looks = 0;
    const { fetch } = fakeFetch(() => {
      looks += 1;
      return json(looks < 3 ? { ...ready, index: { status: "indexing" } } : ready);
    });
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    const waited = await whenIndexed(client, address("/gh/acme/skills"), {
      sleep: async () => undefined,
    });
    expect(waited.index.status).toBe("ready");
    expect(looks).toBe(3);

    const failed = createClient({
      baseUrl: "https://skillcdn.example",
      fetch: async () => json({ ...ready, index: { status: "failed", errorCode: "boom" } }),
    });
    await expect(whenIndexed(failed, address("/gh/acme/skills"))).rejects.toMatchObject({
      code: "index.failed",
    });
    const forever = createClient({
      baseUrl: "https://skillcdn.example",
      fetch: async () => json({ ...ready, index: { status: "indexing" } }),
    });
    await expect(
      whenIndexed(forever, address("/gh/acme/skills"), {
        timeoutMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "index.indexing" });
  });

  it("reads a skill page after page until it is complete", async () => {
    const page = (body: string, nextCursor: string | null): RestSkill => ({
      status: "ready",
      commit: COMMIT,
      skill: {
        path: "ads/SKILL.md",
        name: "ads",
        directory: "ads",
        description: "Ads.",
        license: null,
        compatibility: null,
        allowedTools: null,
        metadata: {},
        body,
        files: [],
        filesTruncated: false,
        included: [],
        warnings: [],
        translations: {},
        rules: null,
        complete: nextCursor === null,
        nextCursor,
      },
    });
    const { fetch, calls } = fakeFetch((url) =>
      json(url.includes("cursor=") ? page(" two", null) : page("one", "c2")),
    );
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    const pages = await skillPages(client, address("/gh/acme/skills"), "ads/SKILL.md");
    expect(pages.map((item) => item.skill.body)).toEqual(["one", " two"]);
    expect(calls[1]?.url).toContain("cursor=c2");
  });
});

describe("a command connecting with a code", () => {
  const item = {
    id: "11111111-1111-4111-8111-111111111111",
    address: "/gh/acme/skills",
    label: "Claude Code on a laptop",
    createdAt: "2026-10-18T00:00:00.000Z",
    expiresAt: "2027-01-16T00:00:00.000Z",
    lastUsedAt: null,
  };

  it("begins, claims, looks and decides at the routes of the API, with their bodies", async () => {
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.endsWith("/api/v1/connect")) {
        return json(
          {
            code: "ABCD-EFGH",
            url: "https://skillcdn.example/connect/ABCD-EFGH",
            secret: "scdn_cx_secret",
            expiresAt: "2026-10-18T00:10:00.000Z",
            intervalSeconds: 5,
          },
          201,
        );
      }
      if (url.endsWith("/connect/claim")) {
        const body = JSON.parse(String(init.body)) as { secret: string };
        return json(
          body.secret === "scdn_cx_secret"
            ? { status: "connected", token: "scdn_repo_token", item }
            : { status: "pending", expiresAt: "2026-10-18T00:10:00.000Z" },
        );
      }
      if (url.endsWith("/decision")) {
        return json({ status: "approved" });
      }
      return json({
        code: "ABCD-EFGH",
        agent: "Claude Code on a laptop",
        address: "/gh/acme/skills",
        expiresAt: "2026-10-18T00:10:00.000Z",
        approved: false,
        user: { host: "gh", login: "alice", name: null, avatar: "https://avatars.example/a" },
        visible: true,
        installUrl: null,
      });
    });
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    const begun = await client.connect({
      address: "/gh/acme/skills",
      agent: "Claude Code on a laptop",
    });
    expect(begun.code).toBe("ABCD-EFGH");
    expect(await client.claimConnection("scdn_cx_other")).toEqual({
      status: "pending",
      expiresAt: "2026-10-18T00:10:00.000Z",
    });
    expect(await client.claimConnection(begun.secret)).toEqual({
      status: "connected",
      token: "scdn_repo_token",
      item,
    });
    expect((await client.connection("ABCD-EFGH")).agent).toBe("Claude Code on a laptop");
    expect(await client.decideConnection("ABCD-EFGH", { approve: true, label: "Laptop" })).toEqual({
      status: "approved",
    });
    expect(
      calls.map((call) => [
        call.init.method,
        call.url.slice("https://skillcdn.example".length),
        call.init.body === undefined ? undefined : JSON.parse(String(call.init.body)),
      ]),
    ).toEqual([
      ["POST", "/api/v1/connect", { address: "/gh/acme/skills", agent: "Claude Code on a laptop" }],
      ["POST", "/api/v1/connect/claim", { secret: "scdn_cx_other" }],
      ["POST", "/api/v1/connect/claim", { secret: "scdn_cx_secret" }],
      ["GET", "/api/v1/connect/ABCD-EFGH", undefined],
      ["POST", "/api/v1/connect/ABCD-EFGH/decision", { approve: true, label: "Laptop" }],
    ]);
  });

  it("says what the server refused a claim with, and when it answered unexpectedly", async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith("/claim")
        ? json({ error: { code: "connect.not_found", message: "Nothing waits." } }, 404)
        : json({ status: "something else" }),
    );
    const client = createClient({ baseUrl: "https://skillcdn.example", fetch });
    await expect(client.claimConnection("scdn_cx_spent")).rejects.toMatchObject({
      status: 404,
      code: "connect.not_found",
    });
    await expect(client.connect({ address: "/gh/acme/skills", agent: "x" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
