import type { LegalTexts, LicenseFact, ShowcaseTexts } from "@skillcdn/core";
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
  primaryKey,
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

/**
 * `owner/name` spellings the git host showed nobody in particular a repository under, the last
 * time a request without a credential asked: nothing by that name, or nothing public. Kept so
 * that every process stops asking the host about the name for a while. A lookup index like
 * `repo_aliases`, not tenant data: a name here belongs to no account. Only requests from nobody
 * in particular write it, so a row says the same about a private repository as about a name
 * that is nothing at all.
 */
export const missingRepos = pgTable(
  "missing_repos",
  {
    id: id(),
    host: text().notNull(),
    owner: text().notNull(),
    name: text().notNull(),
    /** When the host last showed the public nothing under the name. */
    checkedAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("missing_repos_name_key").on(table.host, table.owner, table.name),
    index("missing_repos_checked_idx").on(table.checkedAt),
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
  /**
   * Skill only: the files it needs on every run, as repository-root paths: files of its own
   * directory, and the shared pages outside it that the index admitted (ADR-0044).
   */
  readonly include?: readonly string[];
  /** By language tag: the title (skill) or name (repository), and the description. */
  readonly translations?: Readonly<Record<string, StoredTranslation>>;
  /** Repository manifest only: the directories it serves, relative to its own directory. */
  readonly documents?: readonly string[];
  /** Repository manifest only: relative files or subtrees never published. Empty means self. */
  readonly exclude?: readonly string[];
  /** Repository manifest only: the tag of the language the repository is written in. */
  readonly language?: string;
  /**
   * Repository manifest only: the picture it declares (ADR-0031), as a repository-root path of a
   * file the tree has, or as an `https` URL.
   */
  readonly image?: string;
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
   * Skill only: the files of the skill over the read limit when the commit was indexed
   * (ADR-0033): left out of what is served, and named in the served document with where their
   * bytes are at the host. Kept here so that a read assembles the document the index digested.
   */
  readonly omitted?: readonly {
    readonly path: string;
    readonly size: number;
    readonly sourceUrl: string;
  }[];
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
 * `client` is a keyed hash of the client's network address under the key of the day, which is
 * derived from the deployment's secret and stored nowhere (ADR-0027); it can be matched within the
 * day by whoever holds the secret and means nothing once the day is folded.
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

/**
 * Media the operator uploaded for the landing showcase (ADR-0028), keyed by the SHA-256 of the
 * bytes: content-addressed, so the hash is the primary key and the name the file is served under,
 * which never changes. Operator data, not tenant data; served to everyone.
 */
export const operatorMedia = pgTable("operator_media", {
  sha: text().primaryKey(),
  contentType: text().notNull(),
  size: integer().notNull(),
  bytes: bytea().notNull(),
  createdAt: createdAt(),
});

/**
 * An entry of the landing showcase (ADR-0028): what the front page leads with, in the operator's
 * words, in every language the operator wrote. Operator data, not tenant data.
 */
export const showcaseEntries = pgTable(
  "showcase_entries",
  {
    id: id(),
    /** The entry's name in the admin API and in the pages. */
    slug: text().notNull(),
    position: integer().notNull().default(0),
    /** Canonical, as the address grammar prints it; a ref and a path are allowed. */
    address: text().notNull(),
    /** Pixel size of the clip and its poster. */
    width: integer().notNull(),
    height: integer().notNull(),
    durationMs: integer(),
    published: date({ mode: "string" }),
    /** By language tag: the words of the card and of the example conversation. */
    texts: jsonb().$type<Record<string, ShowcaseTexts>>().notNull(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("showcase_entries_slug_key").on(table.slug),
    index("showcase_entries_position_idx").on(table.position, table.slug),
  ],
);

/**
 * The upload in each slot of a showcase entry. An entry takes its rows with it; an upload that
 * an entry still shows cannot be deleted.
 */
export const showcaseMedia = pgTable(
  "showcase_media",
  {
    entryId: uuid()
      .notNull()
      .references(() => showcaseEntries.id, { onDelete: "cascade" }),
    slot: text({
      enum: ["clip", "animation", "poster", "reference", "picture", "social"],
    }).notNull(),
    sha: text()
      .notNull()
      .references(() => operatorMedia.sha, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.slot] }),
    index("showcase_media_sha_idx").on(table.sha),
    check(
      "showcase_media_slot_check",
      sql`${table.slot} in ('clip', 'animation', 'poster', 'reference', 'picture', 'social')`,
    ),
  ],
);

/**
 * The picture the operator gives an address (ADR-0031), shown in place of the one its repository
 * declares: one of its uploads by hash, or an `https` URL that the reader's browser loads.
 * Exactly one of the two is set. Operator data, not tenant data.
 */
export const operatorImages = pgTable(
  "operator_images",
  {
    id: id(),
    /** Canonical, as the address grammar prints it; a ref and a path are allowed. */
    address: text().notNull(),
    mediaSha: text().references(() => operatorMedia.sha, { onDelete: "restrict" }),
    url: text(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operator_images_address_key").on(table.address),
    index("operator_images_media_idx").on(table.mediaSha),
    check(
      "operator_images_source_check",
      sql`(${table.mediaSha} is null) <> (${table.url} is null)`,
    ),
  ],
);

/**
 * A page of the deployment's own (ADR-0029): its terms of service or its privacy policy, written
 * through the admin API as Markdown in each language the operator has, and served at `/terms`
 * and `/privacy`. Operator data, not tenant data.
 */
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: id(),
    kind: text({ enum: ["terms", "privacy"] }).notNull(),
    /** When the text was last revised, as the operator states it. */
    revised: date({ mode: "string" }),
    /** By language tag: the title, and the body as Markdown. */
    texts: jsonb().$type<Record<string, LegalTexts>>().notNull(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("legal_documents_kind_key").on(table.kind),
    check("legal_documents_kind_check", sql`${table.kind} in ('terms', 'privacy')`),
  ],
);

/**
 * A person who signed in through a git host (docs/specs/permissions.md): which account of the
 * host they are, and what the host calls them. Identity data, not tenant data: what is a
 * person's hangs off the user, and every query on it names the user.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    /** The name the account goes by at the host, when it gives one besides its login. */
    name: text(),
    lastLoginAt: instant().notNull(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_account_key").on(table.accountId)],
);

/**
 * What the git host issued a user at sign-in, encrypted by the caller before it reaches this
 * package: used on the server to ask the host what the user can see, and for nothing else.
 */
export const userCredentials = pgTable(
  "user_credentials",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Ciphertext. */
    accessToken: text().notNull(),
    /** Null for a token the host issued without an expiry. */
    accessExpiresAt: instant(),
    /** Ciphertext; null when the host issues none. */
    refreshToken: text(),
    refreshExpiresAt: instant(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [uniqueIndex("user_credentials_user_key").on(table.userId)],
);

/** A browser a user is signed in on. The cookie holds the token; the row holds its hash. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    expiresAt: instant().notNull(),
    lastSeenAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

/**
 * A client that asks people for access over OAuth: one that registered itself, or the copy of
 * the metadata document a client identifies itself with. What it says about itself is its own
 * word. Not tenant data: a client belongs to nobody here.
 */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: id(),
    /** What the client is called in requests: issued at registration, or the document's URL. */
    clientId: text().notNull(),
    source: text({ enum: ["registration", "document"] }).notNull(),
    name: text().notNull(),
    /** The client's own page, when it names one. */
    uri: text(),
    redirectUris: jsonb().$type<string[]>().notNull(),
    /** How the client proves itself at the token endpoint. */
    authMethod: text({ enum: ["none", "client_secret_basic", "client_secret_post"] }).notNull(),
    /** The hash of the secret issued at registration, for a client that proves itself with one. */
    secretHash: text(),
    /** For a document: until when the copy stands before it is fetched again. */
    freshUntil: instant(),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_clients_client_id_key").on(table.clientId),
    check("oauth_clients_source_check", sql`${table.source} in ('registration', 'document')`),
    check(
      "oauth_clients_auth_method_check",
      sql`${table.authMethod} in ('none', 'client_secret_basic', 'client_secret_post')`,
    ),
  ],
);

/**
 * An authorization code on its way from the consent page to the token endpoint: short-lived,
 * stored as a hash, and deleted by the exchange that uses it.
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: id(),
    codeHash: text().notNull(),
    oauthClientId: uuid()
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text().notNull(),
    codeChallenge: text().notNull(),
    scope: text().notNull(),
    /** The resource as the client named it, and the canonical address it is. */
    resource: text().notNull(),
    address: text().notNull(),
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("oauth_codes_code_hash_key").on(table.codeHash),
    index("oauth_codes_expires_idx").on(table.expiresAt),
  ],
);

/**
 * What a user allowed a client: to read one address as them. Tokens are issued under it and go
 * with it when the user takes it back.
 */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    oauthClientId: uuid()
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    /** Canonical, as the address grammar prints it: the only address its tokens are good for. */
    address: text().notNull(),
    /** The resource as the client named it. */
    resource: text().notNull(),
    scope: text().notNull(),
    lastUsedAt: instant(),
    /** When its newest refresh token expires: past that, nothing can renew it. */
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("oauth_grants_user_idx").on(table.userId),
    index("oauth_grants_client_idx").on(table.oauthClientId),
    index("oauth_grants_expires_idx").on(table.expiresAt),
  ],
);

/**
 * An access token and the refresh token issued with it, as hashes. A refresh token is used
 * once: `rotated_at` says when, and the row stays so that a second use is recognized.
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: id(),
    grantId: uuid()
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    accessHash: text().notNull(),
    accessExpiresAt: instant().notNull(),
    refreshHash: text().notNull(),
    refreshExpiresAt: instant().notNull(),
    rotatedAt: instant(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("oauth_tokens_access_hash_key").on(table.accessHash),
    uniqueIndex("oauth_tokens_refresh_hash_key").on(table.refreshHash),
    index("oauth_tokens_grant_idx").on(table.grantId),
    index("oauth_tokens_refresh_expires_idx").on(table.refreshExpiresAt),
  ],
);

/**
 * The permission cache: what the git host last answered when asked whether a user can see a
 * repository, and when. Only the yes or no is kept, and only for a short while.
 */
export const repoPermissions = pgTable(
  "repo_permissions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    allowed: boolean().notNull(),
    checkedAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("repo_permissions_user_repo_key").on(table.userId, table.repoId),
    index("repo_permissions_checked_idx").on(table.checkedAt),
  ],
);

/**
 * A token a user made for one repository, for an agent that has nobody to sign in
 * (docs/specs/permissions.md). The row holds the hash of the secret. Whoever presents the
 * secret reads as the user who made it, at the addresses of that repository, until it expires
 * or is taken back: what the user may see is asked of the git host on every request, as ever.
 */
export const repoTokens = pgTable(
  "repo_tokens",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: uuid()
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    /** Canonical, as the address grammar prints a repository: the name the token was made under. */
    address: text().notNull(),
    /** What its maker calls it. */
    label: text().notNull(),
    tokenHash: text().notNull(),
    expiresAt: instant().notNull(),
    lastUsedAt: instant(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("repo_tokens_token_hash_key").on(table.tokenHash),
    index("repo_tokens_user_idx").on(table.userId),
    index("repo_tokens_expires_idx").on(table.expiresAt),
  ],
);
