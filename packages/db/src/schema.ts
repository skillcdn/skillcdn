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
  /** Repository manifest only: the directories it serves, relative to its own directory. */
  readonly documents?: readonly string[];
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
     * False for a file that a repository manifest leaves out: stored so that the tree is known,
     * never listed, searched or read (docs/specs/skill-repo.md, "The repository manifest").
     */
    visible: boolean().notNull().default(true),
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
 * UTF-8 file bodies keyed by git blob hash: content-addressed, so the hash is the primary key and
 * one row serves every commit, ref and fork. Not tenant data; reads go through an index entry.
 */
export const blobs = pgTable("blobs", {
  sha: text().primaryKey(),
  content: text().notNull(),
  size: integer().notNull(),
  createdAt: createdAt(),
});
