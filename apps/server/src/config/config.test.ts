import { describe, expect, it } from "vitest";
import { ConfigError, HOSTED_ORIGIN, loadConfig } from "./config.js";

const DATABASE_URL = "postgres://user:not-a-real-password@db.internal:5432/skillcdn";
const noFiles = (): string => {
  throw new Error("no file expected");
};

function problemsOf(environment: Record<string, string | undefined>, readFile = noFiles) {
  try {
    loadConfig(environment, readFile);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the configuration to be rejected");
}

describe("loadConfig", () => {
  it("needs only a database and fills in safe defaults", () => {
    const config = loadConfig({ DATABASE_URL }, noFiles);
    expect(config).toMatchObject({
      environment: "production",
      logLevel: "info",
      http: { host: "0.0.0.0", port: 11188, shutdownGraceMs: 20_000 },
      database: { url: DATABASE_URL, poolMax: 10 },
      github: { apiUrl: "https://api.github.com", token: undefined },
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
    });
    expect(config.indexing.waitMs).toBe(20_000);
    expect(config.indexing.limits.maxIndexedFiles).toBeGreaterThan(0);
  });

  it("reads overrides and treats empty variables as unset", () => {
    const config = loadConfig(
      {
        DATABASE_URL,
        NODE_ENV: "development",
        PORT: "9090",
        LOG_LEVEL: "",
        GITHUB_TOKEN: "",
        GITHUB_API_URL: "https://github.example.test/api/v3",
        INDEX_WAIT_MS: "0",
      },
      noFiles,
    );
    expect(config.http.port).toBe(9090);
    expect(config.logLevel).toBe("info");
    expect(config.github).toEqual({
      apiUrl: "https://github.example.test/api/v3",
      token: undefined,
    });
    expect(config.indexing.waitMs).toBe(0);
  });

  it("trusts no proxy unless told to", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).http).toMatchObject({
      keepAliveMs: 65_000,
      requestTimeoutMs: 60_000,
      accessLog: true,
      trustedProxies: [],
      clientIpHeader: "x-forwarded-for",
      requestIdHeader: "x-request-id",
    });
  });

  it("reads the reverse-proxy settings", () => {
    const config = loadConfig(
      {
        DATABASE_URL,
        TRUSTED_PROXIES: "127.0.0.1, 10.0.0.0/8,::1/128,",
        CLIENT_IP_HEADER: "X-Real-IP",
        REQUEST_ID_HEADER: "X-Trace-Id",
        ACCESS_LOG: "false",
        HTTP_KEEP_ALIVE_SECONDS: "620",
      },
      noFiles,
    );
    expect(config.http).toMatchObject({
      keepAliveMs: 620_000,
      accessLog: false,
      clientIpHeader: "x-real-ip",
      requestIdHeader: "x-trace-id",
      trustedProxies: [
        { address: "127.0.0.1", prefix: 32, family: "ipv4" },
        { address: "10.0.0.0", prefix: 8, family: "ipv4" },
        { address: "::1", prefix: 128, family: "ipv6" },
      ],
    });
  });

  it("rejects proxies that are not networks and headers that are not names", () => {
    const error = problemsOf({
      DATABASE_URL,
      TRUSTED_PROXIES: "10.0.0.0/8, proxy.internal",
      CLIENT_IP_HEADER: "x forwarded for",
      ACCESS_LOG: "yes",
    });
    expect(error.problems.map((problem) => problem.split(":")[0]).sort()).toEqual([
      "ACCESS_LOG",
      "CLIENT_IP_HEADER",
      "TRUSTED_PROXIES",
    ]);
  });

  it("reads the featured addresses and rejects what is not an address", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).web.featured).toEqual([]);
    const config = loadConfig(
      { DATABASE_URL, FEATURED_ADDRESSES: "/gh/Acme/skills, gh/acme/docs@v2/guides," },
      noFiles,
    );
    expect(config.web.featured).toMatchObject([
      { host: "gh", owner: "acme", repo: "skills", path: "" },
      {
        host: "gh",
        owner: "acme",
        repo: "docs",
        ref: { kind: "name", name: "v2" },
        path: "guides",
      },
    ]);
    expect(
      problemsOf({ DATABASE_URL, FEATURED_ADDRESSES: "/gh/acme/skills,https://example.test/x" })
        .problems,
    ).toEqual(["FEATURED_ADDRESSES: must be a list of addresses such as /gh/owner/repo"]);
    const tooMany = Array.from({ length: 25 }, (_, index) => `/gh/acme/repo-${index}`).join(",");
    expect(problemsOf({ DATABASE_URL, FEATURED_ADDRESSES: tooMany }).problems).toEqual([
      "FEATURED_ADDRESSES: must list at most 24 addresses",
    ]);
  });

  it("reads where the web UI is and what the public origin is", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).web).toMatchObject({
      root: undefined,
      publicUrl: HOSTED_ORIGIN,
    });
    expect(loadConfig({ DATABASE_URL, NODE_ENV: "development" }, noFiles).web.publicUrl).toBe(
      undefined,
    );
    const config = loadConfig(
      { DATABASE_URL, WEB_ROOT: "/app/web", PUBLIC_URL: "https://Skills.Example.com/" },
      noFiles,
    );
    expect(config.web).toMatchObject({ root: "/app/web", publicUrl: "https://skills.example.com" });
    for (const value of [
      "skills.example.com",
      "ftp://skills.example.com",
      "https://skills.example.com/app",
      "https://skills.example.com/?x=1",
      "https://user@skills.example.com",
    ]) {
      expect(problemsOf({ DATABASE_URL, PUBLIC_URL: value }).problems, value).toHaveLength(1);
    }
  });

  it("takes the tags for search consoles and analytics, and refuses what is not one", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).web.tags).toEqual({
      googleSiteVerification: undefined,
      googleAnalyticsId: undefined,
    });
    expect(
      loadConfig(
        {
          DATABASE_URL,
          GOOGLE_SITE_VERIFICATION: "abc_DEF-123",
          GOOGLE_ANALYTICS_ID: "G-ABC123XYZ",
        },
        noFiles,
      ).web.tags,
    ).toEqual({ googleSiteVerification: "abc_DEF-123", googleAnalyticsId: "G-ABC123XYZ" });
    for (const bad of [
      { GOOGLE_SITE_VERIFICATION: '<meta content="x">' },
      { GOOGLE_ANALYTICS_ID: "UA-12345-1" },
      { GOOGLE_ANALYTICS_ID: "G-abc" },
    ]) {
      expect(() => loadConfig({ DATABASE_URL, ...bad }, noFiles)).toThrow(ConfigError);
    }
  });

  it("counts usage unless told not to", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).stats).toEqual({ enabled: true, flushMs: 15_000 });
    expect(
      loadConfig({ DATABASE_URL, USAGE_STATS: "false", USAGE_STATS_FLUSH_SECONDS: "60" }, noFiles)
        .stats,
    ).toEqual({ enabled: false, flushMs: 60_000 });
  });

  it("reads secrets from files", () => {
    const files: Record<string, string> = {
      "/run/secrets/db": `${DATABASE_URL}\n`,
      "/run/secrets/gh": "token-from-file\n",
    };
    const config = loadConfig(
      { DATABASE_URL_FILE: "/run/secrets/db", GITHUB_TOKEN_FILE: "/run/secrets/gh" },
      (path) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error("ENOENT");
        }
        return content;
      },
    );
    expect(config.database.url).toBe(DATABASE_URL);
    expect(config.github.token).toBe("token-from-file");
  });

  it("rejects a variable that is given both ways, and a secret file it cannot read", () => {
    expect(problemsOf({ DATABASE_URL, DATABASE_URL_FILE: "/run/secrets/db" }).problems).toContain(
      "DATABASE_URL and DATABASE_URL_FILE are both set; use one",
    );
    expect(
      problemsOf({ DATABASE_URL, GITHUB_TOKEN_FILE: "/missing" }, () => {
        throw new Error("ENOENT");
      }).problems,
    ).toContain("GITHUB_TOKEN_FILE: cannot read /missing");
  });

  it("lists every problem at once, by variable name", () => {
    const error = problemsOf({ PORT: "eighty", NODE_ENV: "staging", REF_TTL_SECONDS: "-1" });
    expect(error.problems.map((problem) => problem.split(":")[0]).sort()).toEqual([
      "DATABASE_URL",
      "NODE_ENV",
      "PORT",
      "REF_TTL_SECONDS",
    ]);
    expect(error.problems).toContain("DATABASE_URL: required");
  });

  it("never repeats a value in an error message", () => {
    const error = problemsOf({
      DATABASE_URL: "mysql://user:hunter2-secret@db/skillcdn",
      GITHUB_API_URL: "ftp://hunter2-secret.example.test",
    });
    expect(error.message).not.toContain("hunter2-secret");
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("GITHUB_API_URL");
  });
});
