import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

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
      http: { host: "0.0.0.0", port: 8080, shutdownGraceMs: 20_000 },
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
