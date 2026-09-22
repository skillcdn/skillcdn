import { readFileSync } from "node:fs";
import { type Address, parseAddress } from "@skillcdn/core";
import * as z from "zod";
import { type Cidr, parseCidr } from "../http/client-address.js";

// The only module that reads the environment. Contract: .env.example and deploy/README.md.

const SECRET_NAMES = ["DATABASE_URL", "GITHUB_TOKEN"] as const;

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const flag = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true");

const headerName = (fallback: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "must be a header name")
    .default(fallback)
    .transform((value) => value.toLowerCase());

/** A comma-separated list of networks in CIDR notation; a bare address means just that address. */
const cidrList = z
  .string()
  .default("")
  .transform((value, context) => {
    const networks: Cidr[] = [];
    for (const entry of value.split(",").filter((part) => part.trim().length > 0)) {
      const parsed = parseCidr(entry);
      if (parsed === undefined) {
        context.addIssue({
          code: "custom",
          message: "must be a list of addresses or CIDR networks",
        });
        return z.NEVER;
      }
      networks.push(parsed);
    }
    return networks;
  });

const MAX_FEATURED_ADDRESSES = 24;

/** A comma-separated list of addresses, as they would be written after the service host. */
const addressList = z
  .string()
  .default("")
  .transform((value, context) => {
    const addresses: Address[] = [];
    for (const entry of value.split(",").filter((part) => part.trim().length > 0)) {
      // With or without the leading slash: some shells rewrite a value that starts with one.
      const text = entry.trim();
      const parsed = parseAddress(text.startsWith("/") ? text : `/${text}`);
      if (!parsed.ok) {
        context.addIssue({
          code: "custom",
          message: "must be a list of addresses such as /gh/owner/repo",
        });
        return z.NEVER;
      }
      addresses.push(parsed.value);
    }
    if (addresses.length > MAX_FEATURED_ADDRESSES) {
      context.addIssue({
        code: "custom",
        message: `must list at most ${MAX_FEATURED_ADDRESSES} addresses`,
      });
      return z.NEVER;
    }
    return addresses;
  });

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: integer(11188, 1, 65_535),
  SHUTDOWN_GRACE_SECONDS: integer(20, 1, 600),
  HTTP_KEEP_ALIVE_SECONDS: integer(65, 1, 3600),
  HTTP_REQUEST_TIMEOUT_SECONDS: integer(60, 1, 3600),
  ACCESS_LOG: flag(true),

  TRUSTED_PROXIES: cidrList,
  CLIENT_IP_HEADER: headerName("x-forwarded-for"),
  REQUEST_ID_HEADER: headerName("x-request-id"),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  DATABASE_POOL_MAX: integer(10, 1, 200),

  GITHUB_API_URL: z.url({ protocol: /^https?$/ }).default("https://api.github.com"),
  GITHUB_TOKEN: z.string().min(1).optional(),

  FEATURED_ADDRESSES: addressList,
  WEB_ROOT: z.string().min(1).optional(),
  PUBLIC_URL: z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      // Checks run even when an earlier one failed. What is not a URL was reported already.
      if (!URL.canParse(value)) {
        return true;
      }
      const url = new URL(value);
      return url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "";
    }, "must be an origin such as https://skills.example.com, without a path")
    .transform((value) => new URL(value).origin)
    .optional(),
  GOOGLE_SITE_VERIFICATION: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/, "must be the content of the verification meta tag")
    .optional(),
  GOOGLE_ANALYTICS_ID: z
    .string()
    .regex(/^G-[A-Z0-9]{4,20}$/, "must be a measurement id such as G-XXXXXXXXXX")
    .optional(),

  USAGE_STATS: flag(true),
  USAGE_STATS_FLUSH_SECONDS: integer(15, 1, 3600),

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

export interface WebTags {
  /** The content of a `google-site-verification` meta tag. */
  readonly googleSiteVerification: string | undefined;
  /** A Google Analytics measurement id (`G-...`). Set, the pages load the analytics script. */
  readonly googleAnalyticsId: string | undefined;
}

export interface Config {
  readonly environment: "development" | "test" | "production";
  readonly logLevel: string;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly shutdownGraceMs: number;
    /** How long an idle connection is kept open. Must outlast the idle timeout of a proxy in front. */
    readonly keepAliveMs: number;
    /** How long a client may take to send one complete request. */
    readonly requestTimeoutMs: number;
    readonly accessLog: boolean;
    /** Peers whose forwarding headers are believed. Empty: nobody's are. */
    readonly trustedProxies: readonly Cidr[];
    /** Lowercase name of the header in which a trusted proxy passes the client address. */
    readonly clientIpHeader: string;
    /** Lowercase name of the header in which a trusted proxy passes its request id. */
    readonly requestIdHeader: string;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly github: {
    readonly apiUrl: string;
    readonly token: string | undefined;
  };
  readonly web: {
    /** Directory of a web UI build to serve. Left out, there is no UI. */
    readonly root: string | undefined;
    /** The origin visitors use. Left out, pages are written for the origin of each request. */
    readonly publicUrl: string | undefined;
    /** Addresses shown on the front page of the explorer. */
    readonly featured: readonly Address[];
    /** Tags written into the head of every page, for search consoles and analytics. */
    readonly tags: WebTags;
  };
  readonly stats: {
    /** Count connections, tool calls and skill loads per public repository and day. */
    readonly enabled: boolean;
    /** How often a process writes what it counted. */
    readonly flushMs: number;
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
      keepAliveMs: env.HTTP_KEEP_ALIVE_SECONDS * 1000,
      requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_SECONDS * 1000,
      accessLog: env.ACCESS_LOG,
      trustedProxies: env.TRUSTED_PROXIES,
      clientIpHeader: env.CLIENT_IP_HEADER,
      requestIdHeader: env.REQUEST_ID_HEADER,
    },
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    github: { apiUrl: env.GITHUB_API_URL, token: env.GITHUB_TOKEN },
    web: {
      root: env.WEB_ROOT,
      publicUrl: env.PUBLIC_URL,
      featured: env.FEATURED_ADDRESSES,
      tags: {
        googleSiteVerification: env.GOOGLE_SITE_VERIFICATION,
        googleAnalyticsId: env.GOOGLE_ANALYTICS_ID,
      },
    },
    stats: { enabled: env.USAGE_STATS, flushMs: env.USAGE_STATS_FLUSH_SECONDS * 1000 },
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
