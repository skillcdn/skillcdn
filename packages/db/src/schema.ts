import type { LicenseFact } from "@skillcdn/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// One file on purpose: drizzle-kit reads it directly. The data model is documented in README.md.

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
});

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const instant = () => timestamp({ withTimezone: true, mode: "date" });
const createdAt = () => instant().notNull().defaultNow();

/** The tenant unit: an organization or a user on a git host. */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    host: text().notNull(),
    hostAccountId: text().notNull(),
    login: text().notNull(),
    kind: text({ enum: ["organization", "user"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_host_account_key").on(table.host, table.hostAccountId),
    check("accounts_kind_check", sql`${table.kind} in ('organization', 'user')`),
  ],
);

/** A repository, identified by the host's immutable id so renames and transfers keep their index. */
export const repos = pgTable(
  "repos",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    host: text().notNull(),
    hostRepoId: text().notNull(),
    name: text().notNull(),
    defaultBranch: text().notNull(),
    /** The host's description of the repository, when it has one. */
    description: text(),
    visibility: text({ enum: ["public", "private"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("repos_host_repo_key").on(table.host, table.hostRepoId),
    index("repos_account_idx").on(table.accountId),
    check("repos_visibility_check", sql`${table.visibility} in ('public', 'private')`),
  ],
);

/**
 * `owner/name` as written in an address (lowercase) to the repository it currently names.
 * A lookup index, not tenant data: it is read before the account is known.
 */
export const repoAliases = pgTable(
  "repo_aliases",
  {
    id: id(),
    host: text().notNull(),
    owner: text().notNull(),
    name: text().notNull(),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    /** When the host last confirmed that the alias names this repository. */
    checkedAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("repo_aliases_name_key").on(table.host, table.owner, table.name),
    index("repo_aliases_repo_idx").on(table.repoId),
  ],
);

/** Cache of moving refs. The empty ref is the default branch. */
export const repoRefs = pgTable(
  "repo_refs",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    ref: text().notNull(),
    commitSha: text().notNull(),
    checkedAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("repo_refs_repo_ref_key").on(table.repoId, table.ref)],
);

/** The index of one commit of one repository, and how far building it has come. */
export const snapshots = pgTable(
  "snapshots",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    commitSha: text().notNull(),
    status: text({ enum: ["pending", "indexing", "ready", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    /** While indexing: after this instant another process may take over. */
    leaseExpiresAt: instant(),
    /**
     * While indexing: the claim that holds it. Renewing, writing, failing and releasing need it,
     * so a holder whose lease ran out cannot undo what its successor did.
     */
    leaseOwner: text(),
    /** After a failure: not before this instant. */
    retryAt: instant(),
    errorCode: text(),
    /** True when the repository was larger than the limits, so the index is partial. */
    truncated: boolean().notNull().default(false),
    fileCount: integer().notNull().default(0),
    indexedFileCount: integer().notNull().default(0),
    indexedBytes: bigint({ mode: "number" }).notNull().default(0),
    /** Skipped manifests and similar findings for the repository author. Capped by the writer. */
    diagnostics: jsonb().$type<SnapshotDiagnostic[]>().notNull().default([]),
    /**
     * The license that governs the repository outside its skills (ADR-0026): its license file,
     * else its root manifest's field. Null before the index is written.
     */
    license: jsonb().$type<LicenseFact>(),
    /**
     * The version of the reading rules the index was written with; 0 before it is written. An
     * index below the rules in force goes back to `pending` when it is next asked for.
     */
    indexVersion: integer().notNull().default(0),
    indexedAt: instant(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("snapshots_repo_commit_key").on(table.repoId, table.commitSha),
    index("snapshots_account_idx").on(table.accountId),
    check(
      "snapshots_status_check",
      sql`${table.status} in ('pending', 'indexing', 'ready', 'failed')`,
    ),
  ],
);

export interface SnapshotDiagnostic {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** What people see in one language instead of a name and a description. */
export interface StoredTranslation {
  /** A skill's translated title. */
  readonly title?: string;
  /** A repository's translated name. */
  readonly name?: string;
  readonly description?: string;
}

/**
 * Front-matter of a skill manifest, as validated by the convention parser. A repository manifest
 * (`SKILLCDN.md`) stores its front-matter here too, with the document directories it declares.
 */
export interface SkillFrontMatter {
  readonly license?: string;
  readonly compatibility?: string;
  readonly allowedTools?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
  /** Skill only: the files it needs on every run, relative to its directory. */
  readonly include?: readonly string[];
  /** By language tag: the title (skill) or name (repository), and the description. */
  readonly translations?: Readonly<Record<string, StoredTranslation>>;
  /** Repository manifest only: the directories it serves, relative to its own directory. */
  readonly documents?: readonly string[];
  /** Repository manifest only: relative files or subtrees never published. Empty means self. */
  readonly exclude?: readonly string[];
  /** Repository manifest only: the tag of the language the repository is written in. */
  readonly language?: string;
  /** Local Markdown destinations, normalized to repository-root paths. */
  readonly references?: readonly { readonly href: string; readonly path: string }[];
  /** Readable through a link, without becoming an independent catalog/search document. */
  readonly linkedOnly?: boolean;
  /** Readable as a directory introduction, without creating a catalog/search document. */
  readonly overviewOnly?: boolean;
  /** A present but unreadable repository manifest still defines a closed boundary. */
  readonly manifestError?: string;
  /** Skill only: why the MCP skills extension does not list it (ADR-0025), when it does not. */
  readonly unlisted?: string;
  /**
   * The license that governs the file (ADR-0026): for a skill, the one resolved for it; for a
   * license file, what the file itself says.
   */
  readonly licenseFact?: LicenseFact;
}

/** One file of a snapshot. Immutable: rows are inserted and deleted, never updated. */
export const indexEntries = pgTable(
  "index_entries",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    snapshotId: uuid()
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    path: text().notNull(),
    kind: text({ enum: ["skill", "manifest", "markdown", "json", "other"] }).notNull(),
    size: integer().notNull(),
    blobSha: text().notNull(),
    /** The skill directory that owns the file; for a skill manifest, its own directory. */
    skillDir: text(),
    /** Skill name, or the name a repository manifest gives the repository. */
    name: text(),
    /** Document title. */
    title: text(),
    description: text(),
    frontMatter: jsonb().$type<SkillFrontMatter>(),
    /** Null for files that are listed but not searchable. */
    search: tsvector(),
    /**
     * False for a file the reading rules leave out, outside the skills and the document
     * directories: stored so that the tree is known, never listed, searched or read
     * (docs/specs/skill-repo.md).
     */
    visible: boolean().notNull().default(true),
    /**
     * SHA-256 of the bytes the file is served as, in hex, when they are stored: for a listed
     * skill's `SKILL.md` the assembled document, otherwise the body itself (ADR-0025).
     */
    digest: text(),
    /** The size of what is served, which differs from `size` for an assembled `SKILL.md`. */
    servedSize: integer(),
    /** True for a skill the MCP skills extension lists; the reason it is not is in `front_matter`. */
    listed: boolean().notNull().default(false),
    /**
     * For a skill: what its license allows (ADR-0026). A restrictive skill is described, not
     * served, unless the repository is verified, and the extension lists it only then.
     */
    licenseKind: text({ enum: ["permissive", "restrictive", "none"] }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("index_entries_snapshot_path_key").on(table.snapshotId, table.path),
    index("index_entries_snapshot_kind_idx").on(table.snapshotId, table.kind),
    index("index_entries_snapshot_skill_dir_idx").on(table.snapshotId, table.skillDir),
    index("index_entries_search_idx").using("gin", table.search),
    index("index_entries_account_idx").on(table.accountId),
    check(
      "index_entries_kind_check",
      sql`${table.kind} in ('skill', 'manifest', 'markdown', 'json', 'other')`,
    ),
    check(
      "index_entries_license_kind_check",
      sql`${table.licenseKind} is null or ${table.licenseKind} in ('permissive', 'restrictive', 'none')`,
    ),
  ],
);

/**
 * How often something happened to a repository on one day (UTC): a counter per metric and
 * subject, added to and never rewritten. Nothing here identifies a client.
 */
export const usageDaily = pgTable(
  "usage_daily",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    metric: text({ enum: ["connection", "tool_call", "skill_load", "client"] }).notNull(),
    /** What the metric is about: the tool name, the skill directory, or empty. */
    subject: text().notNull().default(""),
    count: bigint({ mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_daily_key").on(table.repoId, table.day, table.metric, table.subject),
    index("usage_daily_day_metric_idx").on(table.day, table.metric),
    index("usage_daily_account_idx").on(table.accountId),
    check(
      "usage_daily_metric_check",
      sql`${table.metric} in ('connection', 'tool_call', 'skill_load', 'client')`,
    ),
  ],
);

/**
 * The distinct clients that used a repository on one day (UTC), while that day is being counted.
 * `client` is a keyed hash of the client's network address under the day's key in
 * `usage_client_keys`; it can be matched within the day and means nothing once the key is gone.
 * Rows and the key are deleted together when the day is folded into `usage_daily` as `client`.
 */
export const usageClients = pgTable(
  "usage_clients",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    client: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("usage_clients_key").on(table.repoId, table.day, table.client),
    index("usage_clients_day_idx").on(table.day),
    index("usage_clients_account_idx").on(table.accountId),
  ],
);

/** The key under which client addresses are hashed on one day. Random, and gone with the day. */
export const usageClientKeys = pgTable(
  "usage_client_keys",
  {
    id: id(),
    day: date({ mode: "string" }).notNull(),
    key: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("usage_client_keys_day_key").on(table.day)],
);

/**
 * The operator's lists (ADR-0026): repositories it vouches for, addresses it features, and
 * repositories it does not serve. Operator data, not tenant data: written through the admin
 * API, read by every process.
 */
export const operatorRepositories = pgTable(
  "operator_repositories",
  {
    id: id(),
    kind: text({ enum: ["verified", "featured", "blocked"] }).notNull(),
    /** Canonical: `/gh/owner/repo`; a featured entry may carry a ref and a path. */
    address: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("operator_repositories_kind_address_key").on(table.kind, table.address),
    check(
      "operator_repositories_kind_check",
      sql`${table.kind} in ('verified', 'featured', 'blocked')`,
    ),
  ],
);

/**
 * File bodies keyed by git blob hash: content-addressed, so the hash is the primary key and one
 * row serves every commit, ref and fork. Not tenant data; reads go through an index entry.
 */
export const blobs = pgTable("blobs", {
  sha: text().primaryKey(),
  /**
   * The body as the repository has it. Rows written before bytes were stored hold `content` only
   * and are read from it until they are written again.
   */
  bytes: bytea(),
  /** The body as text, for rows from before `bytes`; no longer written. */
  content: text(),
  size: integer().notNull(),
  createdAt: createdAt(),
});
