import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { GitHostError, type GitHostErrorKind, type RepoCoordinates } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createGitHubHost, type GitHubHostOptions } from "./github-host.js";
import type { FetchLike } from "./http.js";
import { tarArchive } from "./testing/tar-writer.js";

interface RecordedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const fixture: {
  readonly commit: string;
  readonly blob: { readonly path: string; readonly sha: string };
  readonly responses: Readonly<Record<string, RecordedResponse>>;
} = JSON.parse(readFileSync(new URL("../fixtures/api.json", import.meta.url), "utf8"));

const BASE_URL = "https://api.github.test";
const repo: RepoCoordinates = { host: "gh", owner: "skillcdn", repo: "skillcdn" };

interface SeenRequest {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Serves recorded replies, answers 304 to a matching If-None-Match, and records what it was asked. */
function replay(overrides: Readonly<Record<string, RecordedResponse | Error>> = {}) {
  const seen: SeenRequest[] = [];
  const fetchLike: FetchLike = async (input, init) => {
    const url = new URL(input);
    const key = `${init.method} ${url.pathname}${url.search}`;
    const headers = init.headers as Record<string, string>;
    seen.push({ key, headers });
    const recorded = overrides[key] ?? fixture.responses[key];
    if (recorded === undefined) {
      throw new Error(`no recorded response for ${key}`);
    }
    if (recorded instanceof Error) {
      throw recorded;
    }
    if (recorded.headers.etag !== undefined && headers["if-none-match"] === recorded.headers.etag) {
      return new Response(null, { status: 304, headers: recorded.headers });
    }
    const noBody = recorded.status === 304 || recorded.status === 204;
    return new Response(noBody ? null : recorded.body, {
      status: recorded.status,
      headers: recorded.headers,
    });
  };
  return { fetchLike, seen };
}

function host(fetchLike: FetchLike, options: Partial<GitHubHostOptions> = {}) {
  return createGitHubHost({
    baseUrl: BASE_URL,
    userAgent: "skillcdn-test",
    fetch: fetchLike,
    retryBaseDelayMs: 0,
    ...options,
  });
}

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

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

describe("getRepository", () => {
  it("maps a recorded repository to domain terms", async () => {
    const { fetchLike } = replay();
    expect(await host(fetchLike).getRepository(repo)).toEqual({
      hostRepoId: "1379202123",
      owner: { hostAccountId: "331879177", login: "skillcdn", kind: "organization" },
      name: "skillcdn",
      defaultBranch: "main",
      description: undefined,
      visibility: "public",
    });
  });

  it("treats everything that is not plainly public as private", async () => {
    const base = JSON.parse(fixture.responses["GET /repos/skillcdn/skillcdn"]?.body ?? "{}");
    for (const patch of [
      { private: true, visibility: "private" },
      { private: false, visibility: "internal" },
      { private: true, visibility: undefined },
    ]) {
      const { fetchLike } = replay({
        "GET /repos/skillcdn/skillcdn": json(200, { ...base, ...patch }),
      });
      expect((await host(fetchLike).getRepository(repo)).visibility).toBe("private");
    }
  });

  it("revalidates with the stored ETag instead of refetching", async () => {
    const { fetchLike, seen } = replay();
    const github = host(fetchLike);
    const first = await github.getRepository(repo);
    const second = await github.getRepository(repo);
    expect(second).toEqual(first);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.headers["if-none-match"]).toBeUndefined();
    expect(seen[1]?.headers["if-none-match"]).toBe(
      fixture.responses["GET /repos/skillcdn/skillcdn"]?.headers.etag,
    );
  });

  it("follows a rename redirect that stays on the configured origin", async () => {
    const { fetchLike, seen } = replay({
      "GET /repos/skillcdn/old-name": {
        status: 301,
        headers: { location: `${BASE_URL}/repos/skillcdn/skillcdn` },
        body: "",
      },
    });
    const renamed = await host(fetchLike).getRepository({ ...repo, repo: "old-name" });
    expect(renamed.name).toBe("skillcdn");
    expect(seen.map((request) => request.key)).toEqual([
      "GET /repos/skillcdn/old-name",
      "GET /repos/skillcdn/skillcdn",
    ]);
  });
});

describe("resolveRef", () => {
  it("resolves the default branch, a name and a pinned commit", async () => {
    const { fetchLike, seen } = replay({
      "GET /repos/skillcdn/skillcdn/commits/release/1.2": {
        status: 200,
        headers: {},
        body: fixture.commit,
      },
    });
    const github = host(fetchLike);
    expect(await github.resolveRef(repo, undefined)).toMatch(/^[0-9a-f]{40}$/);
    expect(await github.resolveRef(repo, { kind: "commit", hash: fixture.commit })).toBe(
      fixture.commit,
    );
    expect(await github.resolveRef(repo, { kind: "name", name: "release/1.2" })).toBe(
      fixture.commit,
    );
    expect(seen.map((request) => request.key)).toContain(
      "GET /repos/skillcdn/skillcdn/commits/release/1.2",
    );
  });

  it("percent-encodes ref names without touching the slashes", async () => {
    const { fetchLike, seen } = replay({
      "GET /repos/skillcdn/skillcdn/commits/feature/a%23b%3Fc": {
        status: 200,
        headers: {},
        body: fixture.commit,
      },
    });
    await host(fetchLike).resolveRef(repo, { kind: "name", name: "feature/a#b?c" });
    expect(seen[0]?.key).toBe("GET /repos/skillcdn/skillcdn/commits/feature/a%23b%3Fc");
  });

  it("reports an unknown ref as not found", async () => {
    const { fetchLike } = replay();
    const error = await failureOf(
      host(fetchLike).resolveRef(repo, { kind: "name", name: "no-such-ref" }),
    );
    expect(error.kind).toBe("not_found");
  });

  it("rejects a reply that is not a commit hash", async () => {
    const { fetchLike } = replay({
      "GET /repos/skillcdn/skillcdn/commits/HEAD": {
        status: 200,
        headers: {},
        body: "<html>",
      },
    });
    expect((await failureOf(host(fetchLike).resolveRef(repo, undefined))).kind).toBe("invalid");
  });
});

describe("getTree", () => {
  it("lists the files of a recorded tree and leaves directories out", async () => {
    const { fetchLike } = replay();
    const tree = await host(fetchLike).getTree(repo, fixture.commit);
    expect(tree.truncated).toBe(false);
    expect(tree.entries.every((entry) => entry.type === "file")).toBe(true);
    expect(tree.entries.find((entry) => entry.path === fixture.blob.path)).toEqual({
      path: fixture.blob.path,
      type: "file",
      size: 686,
      hash: fixture.blob.sha,
    });
    expect(tree.entries.some((entry) => entry.path === "skills")).toBe(false);
  });

  it("reports symlinks and submodules, and drops entries it cannot trust", async () => {
    const sha = "a".repeat(40);
    const key = `GET /repos/skillcdn/skillcdn/git/trees/${fixture.commit}?recursive=1`;
    const { fetchLike } = replay({
      [key]: json(200, {
        truncated: false,
        tree: [
          { path: "docs", mode: "040000", type: "tree", sha },
          { path: "docs/guide.md", mode: "100644", type: "blob", sha, size: 12 },
          { path: "docs/link.md", mode: "120000", type: "blob", sha, size: 9 },
          { path: "vendor/lib", mode: "160000", type: "commit", sha },
          { path: "../outside.md", mode: "100644", type: "blob", sha, size: 1 },
          { path: "docs//double.md", mode: "100644", type: "blob", sha, size: 1 },
          { path: "docs/short-hash.md", mode: "100644", type: "blob", sha: "abc", size: 1 },
        ],
      }),
    });
    const tree = await host(fetchLike).getTree(repo, fixture.commit);
    expect(tree.entries).toEqual([
      { path: "docs/guide.md", type: "file", size: 12, hash: sha },
      { path: "docs/link.md", type: "symlink", size: 0, hash: sha },
      { path: "vendor/lib", type: "submodule", size: 0, hash: sha },
    ]);
    expect(tree.truncated).toBe(true);
  });

  it("refuses anything but a full commit hash without calling the host", async () => {
    const { fetchLike, seen } = replay();
    expect((await failureOf(host(fetchLike).getTree(repo, "main"))).kind).toBe("invalid");
    expect(seen).toHaveLength(0);
  });
});

describe("readBlob", () => {
  it("returns the recorded bytes", async () => {
    const { fetchLike } = replay();
    const bytes = await host(fetchLike).readBlob(repo, fixture.blob.sha, 4096);
    expect(bytes.byteLength).toBe(686);
    expect(new TextDecoder().decode(bytes)).toContain("name: commit-messages");
  });

  it("stops reading a blob that is larger than allowed", async () => {
    const { fetchLike } = replay();
    const error = await failureOf(host(fetchLike).readBlob(repo, fixture.blob.sha, 100));
    expect(error.kind).toBe("invalid");
  });

  it("refuses anything but a full object hash without calling the host", async () => {
    const { fetchLike, seen } = replay();
    const error = await failureOf(host(fetchLike).readBlob(repo, "../../user", 100));
    expect(error.kind).toBe("invalid");
    expect(seen).toHaveLength(0);
  });
});

describe("failures", () => {
  it.each<[string, RecordedResponse, GitHostErrorKind]>([
    ["missing", json(404, { message: "Not Found" }), "not_found"],
    ["forbidden", json(403, { message: "Forbidden" }), "not_found"],
    ["unauthorized", json(401, { message: "Bad credentials" }), "not_found"],
    ["legally unavailable", json(451, { message: "Unavailable" }), "not_found"],
    ["server error", json(502, { message: "Bad Gateway" }), "transient"],
    ["unexpected status", json(418, { message: "teapot" }), "invalid"],
    ["malformed JSON", { status: 200, headers: {}, body: "{not json" }, "invalid"],
    ["unexpected shape", json(200, { id: "not-a-number" }), "invalid"],
  ])("maps a %s reply", async (_name, response, kind) => {
    const { fetchLike } = replay({ "GET /repos/skillcdn/skillcdn": response });
    expect((await failureOf(host(fetchLike).getRepository(repo))).kind).toBe(kind);
  });

  it("makes a missing and a forbidden repository indistinguishable", async () => {
    const missing = replay({ "GET /repos/skillcdn/skillcdn": json(404, { message: "Not Found" }) });
    const forbidden = replay({
      "GET /repos/skillcdn/skillcdn": json(403, { message: "Resource not accessible" }),
    });
    const a = await failureOf(host(missing.fetchLike).getRepository(repo));
    const b = await failureOf(host(forbidden.fetchLike).getRepository(repo));
    expect({ code: a.code, message: a.message }).toEqual({ code: b.code, message: b.message });
  });

  it("reports both kinds of rate limit with when to come back", async () => {
    const reset = String(Math.ceil(Date.now() / 1000) + 120);
    const primary = replay({
      "GET /repos/skillcdn/skillcdn": json(
        403,
        { message: "API rate limit exceeded" },
        { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
      ),
    });
    const secondary = replay({
      "GET /repos/skillcdn/skillcdn": json(429, { message: "slow down" }, { "retry-after": "30" }),
    });
    const a = await failureOf(host(primary.fetchLike).getRepository(repo));
    const b = await failureOf(host(secondary.fetchLike).getRepository(repo));
    expect(a.kind).toBe("rate_limited");
    expect(a.retryAfterSeconds).toBeGreaterThan(100);
    expect(a.retryAfterSeconds).toBeLessThanOrEqual(121);
    expect(b).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 30 });
    expect(primary.seen).toHaveLength(1);
  });

  it("retries transient failures and gives up after the configured attempts", async () => {
    const flaky = replay({ "GET /repos/skillcdn/skillcdn": new Error("socket hang up") });
    const error = await failureOf(host(flaky.fetchLike, { attempts: 3 }).getRepository(repo));
    expect(error.kind).toBe("transient");
    expect(flaky.seen).toHaveLength(3);

    const missing = replay();
    await failureOf(host(missing.fetchLike).getRepository({ ...repo, repo: "does-not-exist" }));
    expect(missing.seen).toHaveLength(1);
  });

  it("never follows a redirect that leaves the configured origin", async () => {
    const { fetchLike, seen } = replay({
      "GET /repos/skillcdn/skillcdn": {
        status: 302,
        headers: { location: "https://attacker.test/collect" },
        body: "",
      },
    });
    const error = await failureOf(
      host(fetchLike, { token: async () => "test-token" }).getRepository(repo),
    );
    expect(error.kind).toBe("invalid");
    expect(seen).toHaveLength(1);
  });
});

describe("credentials", () => {
  it("sends the token as a bearer credential and keeps it out of errors", async () => {
    const { fetchLike, seen } = replay({
      "GET /repos/skillcdn/skillcdn": json(500, { message: "boom test-token" }),
    });
    const github = host(fetchLike, { token: async () => "test-token", attempts: 1 });
    const error = await failureOf(github.getRepository(repo));
    expect(seen[0]?.headers.authorization).toBe("Bearer test-token");
    expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain("test-token");
  });

  it("sends no authorization header without a token", async () => {
    const { fetchLike, seen } = replay();
    await host(fetchLike, { token: async () => undefined }).getRepository(repo);
    await host(fetchLike).getRepository(repo);
    expect(seen.every((request) => request.headers.authorization === undefined)).toBe(true);
    expect(seen[0]?.headers["user-agent"]).toBe("skillcdn-test");
  });
});

describe("readArchive", () => {
  const ARCHIVE_PATH = `/repos/skillcdn/skillcdn/tarball/${fixture.commit}`;
  const DOWNLOAD_ORIGIN = "https://downloads.github.test";

  function archiveHost(
    archive: Uint8Array,
    options: { location?: string; downloadOrigins?: string[] } = {},
  ) {
    const seen: { url: string; authorization: string | undefined }[] = [];
    const fetchLike: FetchLike = async (input, init) => {
      const headers = init.headers as Record<string, string>;
      seen.push({ url: input, authorization: headers.authorization });
      if (new URL(input).pathname === ARCHIVE_PATH) {
        return new Response(null, {
          status: 302,
          headers: { location: options.location ?? `${DOWNLOAD_ORIGIN}/archive?token=short-lived` },
        });
      }
      return new Response(gzipSync(archive), { status: 200 });
    };
    const github = host(fetchLike, {
      token: async () => "test-token",
      downloadOrigins: options.downloadOrigins ?? [DOWNLOAD_ORIGIN],
    });
    return { github, seen };
  }

  async function collect(
    github: ReturnType<typeof host>,
    request: { wants?: (path: string, size: number) => boolean; maxArchiveBytes?: number } = {},
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const archive = github.readArchive?.(repo, fixture.commit, {
      wants: request.wants ?? (() => true),
      maxArchiveBytes: request.maxArchiveBytes ?? 10_000_000,
    });
    if (archive === undefined) {
      throw new Error("the adapter must offer an archive transport");
    }
    for await (const file of archive) {
      files[file.path] = new TextDecoder().decode(file.bytes);
    }
    return files;
  }

  const sample = tarArchive([
    {
      type: "g",
      path: "pax_global_header",
      data: "52 comment=0123456789abcdef0123456789abcdef01234567\n",
    },
    { type: "5", path: "skillcdn-skillcdn-0e169f0/" },
    { path: "skillcdn-skillcdn-0e169f0/README.md", data: "# Readme\n" },
    { path: "skillcdn-skillcdn-0e169f0/skills/ads/SKILL.md", data: "---\nname: ads\n---\n" },
    { path: "skillcdn-skillcdn-0e169f0/assets/logo.png", data: "not really a png" },
    { path: "skillcdn-skillcdn-0e169f0/../outside.md", data: "traversal" },
    { path: "top-level-file-without-a-directory", data: "stray" },
  ]);

  it("streams the wanted files with repository-relative paths", async () => {
    const { github } = archiveHost(sample);
    expect(await collect(github, { wants: (path) => path.endsWith(".md") })).toEqual({
      "README.md": "# Readme\n",
      "skills/ads/SKILL.md": "---\nname: ads\n---\n",
    });
  });

  it("drops entries whose path is not a valid repository path", async () => {
    const { github } = archiveHost(sample);
    const files = await collect(github);
    expect(Object.keys(files).sort()).toEqual([
      "README.md",
      "assets/logo.png",
      "skills/ads/SKILL.md",
      "top-level-file-without-a-directory",
    ]);
  });

  it("sends the credential to the API and never to the download origin", async () => {
    const { github, seen } = archiveHost(sample);
    await collect(github);
    expect(seen).toEqual([
      { url: `${BASE_URL}${ARCHIVE_PATH}`, authorization: "Bearer test-token" },
      { url: `${DOWNLOAD_ORIGIN}/archive?token=short-lived`, authorization: undefined },
    ]);
  });

  it("refuses a download origin the operator did not allow, without leaking the target", async () => {
    const elsewhere = archiveHost(sample, {
      location: "https://attacker.test/archive?token=secret",
    });
    const error = await failureOf(collect(elsewhere.github));
    expect(error.kind).toBe("invalid");
    expect(`${error.message} ${String(error.cause)}`).not.toContain("attacker.test");
    expect(elsewhere.seen).toHaveLength(1);

    const plainHttp = archiveHost(sample, {
      location: "http://downloads.github.test/archive",
      downloadOrigins: ["http://downloads.github.test"],
    });
    expect((await failureOf(collect(plainHttp.github))).kind).toBe("invalid");
  });

  it("stops at the unpacked size limit, even when the download is tiny", async () => {
    const bomb = tarArchive([
      { path: "repo/first.md", data: "kept" },
      { path: "repo/zeros.bin", data: new Uint8Array(5_000_000) },
      { path: "repo/last.md", data: "never reached" },
    ]);
    expect(gzipSync(bomb).byteLength).toBeLessThan(20_000);
    const { github } = archiveHost(bomb);
    expect(await collect(github, { maxArchiveBytes: 100_000 })).toEqual({ "first.md": "kept" });
  });

  it("reports a corrupt archive as invalid", async () => {
    const { github } = archiveHost(
      new TextEncoder().encode("this is not a tar archive".repeat(40)),
    );
    expect((await failureOf(collect(github))).kind).toBe("invalid");

    const notGzip: FetchLike = async (input) =>
      new URL(input).pathname === ARCHIVE_PATH
        ? new Response(null, { status: 302, headers: { location: `${DOWNLOAD_ORIGIN}/x` } })
        : new Response("plain text, not gzip", { status: 200 });
    const github2 = host(notGzip, { downloadOrigins: [DOWNLOAD_ORIGIN] });
    expect((await failureOf(collect(github2))).kind).toBe("invalid");
  });

  it("maps a missing commit to not found", async () => {
    const missing: FetchLike = async () => new Response("{}", { status: 404 });
    expect((await failureOf(collect(host(missing)))).kind).toBe("not_found");
  });
});
