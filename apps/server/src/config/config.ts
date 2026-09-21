import { readFileSync } from "node:fs";
import * as z from "zod";

// The only module that reads the environment. Contract: .env.example and deploy/README.md.

const SECRET_NAMES = ["DATABASE_URL", "GITHUB_TOKEN"] as const;

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: integer(8080, 1, 65_535),
  SHUTDOWN_GRACE_SECONDS: integer(20, 1, 600),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  DATABASE_POOL_MAX: integer(10, 1, 200),

  GITHUB_API_URL: z.url({ protocol: /^https?$/ }).default("https://api.github.com"),
  GITHUB_TOKEN: z.string().min(1).optional(),

  REPO_TTL_SECONDS: integer(60, 0, 86_400),
  REF_TTL_SECONDS: integer(60, 0, 86_400),

  INDEX_WAIT_MS: integer(20_000, 0, 120_000),
  INDEX_CONCURRENCY: integer(2, 1, 64),
  INDEX_LEASE_SECONDS: integer(120, 10, 3600),
  INDEX_MAX_TREE_ENTRIES: integer(20_000, 1, 1_000_000),
  INDEX_MAX_FILES: integer(2000, 1, 100_000),
  INDEX_MAX_FILE_BYTES: integer(262_144, 1024, 16_777_216),
  INDEX_MAX_TOTAL_BYTES: integer(33_554_432, 1024, 1_073_741_824),
  READ_MAX_FILE_BYTES: integer(1_048_576, 1024, 16_777_216),
  INDEX_MAX_ARCHIVE_BYTES: integer(268_435_456, 1_048_576, 17_179_869_184),
});

export interface Config {
  readonly environment: "development" | "test" | "production";
  readonly logLevel: string;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly shutdownGraceMs: number;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly github: {
    readonly apiUrl: string;
    readonly token: string | undefined;
  };
  readonly mounts: {
    /** How long what the host said about a repository name is trusted. */
    readonly repoTtlMs: number;
    /** How long a moving ref is trusted. */
    readonly refTtlMs: number;
  };
  readonly indexing: {
    /** How long a tool call waits for an index before answering "still indexing". */
    readonly waitMs: number;
    readonly concurrency: number;
    readonly leaseMs: number;
    readonly limits: {
      readonly maxTreeEntries: number;
      readonly maxIndexedFiles: number;
      readonly maxIndexedFileBytes: number;
      readonly maxIndexedTotalBytes: number;
      readonly maxReadableFileBytes: number;
      readonly maxArchiveBytes: number;
    };
  };
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Resolves `NAME_FILE` into `NAME` so that container secret mounts work. */
function withSecretFiles(
  environment: Environment,
  readFile: (path: string) => string,
  problems: string[],
): Environment {
  const resolved: Record<string, string | undefined> = { ...environment };
  for (const name of SECRET_NAMES) {
    const file = environment[`${name}_FILE`];
    if (file === undefined || file.length === 0) {
      continue;
    }
    if (environment[name] !== undefined && environment[name] !== "") {
      problems.push(`${name} and ${name}_FILE are both set; use one`);
      continue;
    }
    try {
      resolved[name] = readFile(file).trim();
    } catch {
      // The path is operator input and safe to echo; the content never is.
      problems.push(`${name}_FILE: cannot read ${file}`);
    }
  }
  return resolved;
}

/**
 * Parses and validates the environment once, at boot. Problems name the variable and the rule,
 * never the value: a connection string or a token must not end up in a log.
 */
export function loadConfig(
  environment: Environment = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Config {
  const problems: string[] = [];
  const resolved = withSecretFiles(environment, readFile, problems);
  // An empty variable means "not set": compose files and shells produce those easily.
  const present = Object.fromEntries(
    Object.entries(resolved).filter(([, value]) => value !== undefined && value !== ""),
  );
  const parsed = environmentSchema.safeParse(present);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path.join(".");
      problems.push(
        issue.code === "invalid_type" ? `${name}: required` : `${name}: ${issue.message}`,
      );
    }
  }
  if (!parsed.success || problems.length > 0) {
    throw new ConfigError(problems);
  }

  const env = parsed.data;
  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    http: {
      host: env.HOST,
      port: env.PORT,
      shutdownGraceMs: env.SHUTDOWN_GRACE_SECONDS * 1000,
    },
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    github: { apiUrl: env.GITHUB_API_URL, token: env.GITHUB_TOKEN },
    mounts: { repoTtlMs: env.REPO_TTL_SECONDS * 1000, refTtlMs: env.REF_TTL_SECONDS * 1000 },
    indexing: {
      waitMs: env.INDEX_WAIT_MS,
      concurrency: env.INDEX_CONCURRENCY,
      leaseMs: env.INDEX_LEASE_SECONDS * 1000,
      limits: {
        maxTreeEntries: env.INDEX_MAX_TREE_ENTRIES,
        maxIndexedFiles: env.INDEX_MAX_FILES,
        maxIndexedFileBytes: env.INDEX_MAX_FILE_BYTES,
        maxIndexedTotalBytes: env.INDEX_MAX_TOTAL_BYTES,
        maxReadableFileBytes: env.READ_MAX_FILE_BYTES,
        maxArchiveBytes: env.INDEX_MAX_ARCHIVE_BYTES,
      },
    },
  };
}
