import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
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

/** Front-matter of a skill manifest, as validated by the convention parser. */
export interface SkillFrontMatter {
  readonly license?: string;
  readonly compatibility?: string;
  readonly allowedTools?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
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
    kind: text({ enum: ["skill", "markdown", "json", "other"] }).notNull(),
    size: integer().notNull(),
    blobSha: text().notNull(),
    /** The skill directory that owns the file; for a manifest, its own directory. */
    skillDir: text(),
    /** Skill name. */
    name: text(),
    /** Document title. */
    title: text(),
    description: text(),
    frontMatter: jsonb().$type<SkillFrontMatter>(),
    /** Null for files that are listed but not searchable. */
    search: tsvector(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("index_entries_snapshot_path_key").on(table.snapshotId, table.path),
    index("index_entries_snapshot_kind_idx").on(table.snapshotId, table.kind),
    index("index_entries_snapshot_skill_dir_idx").on(table.snapshotId, table.skillDir),
    index("index_entries_search_idx").using("gin", table.search),
    index("index_entries_account_idx").on(table.accountId),
    check("index_entries_kind_check", sql`${table.kind} in ('skill', 'markdown', 'json', 'other')`),
  ],
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
