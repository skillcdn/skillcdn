import {
  assembleSkillDocument,
  type BlobStore,
  BROWSE_DEFAULT_LIMIT,
  type BrowseEntry,
  type BrowseResult,
  browseCatalogFiles,
  type CatalogFile,
  type CatalogState,
  contextPage,
  type DirectoryResult,
  decodeText,
  FIND_DEFAULT_LIMIT,
  FIND_LIST_SKILLS_MAX,
  FIND_MAX_SKILL_FILES,
  type FileReference,
  type FileResult,
  type FindFile,
  type FindItem,
  type FindResult,
  type FolderOverview,
  folderOverview,
  formatSkillUri,
  frontMatterObject,
  type GitHost,
  type IncludedFile,
  type IndexDiagnostic,
  type IndexLimits,
  isWithinRepoPath,
  joinRepoPath,
  type LicenseFact,
  licenseOfPath,
  type MountCatalog,
  type MountSummary,
  NO_LICENSE,
  pageOfText,
  parentDirectory,
  parseFrontMatter,
  parseRepoPath,
  parseSkillUri,
  READ_FILE_DEFAULT_LIMIT,
  type RepoPath,
  type RepoTranslation,
  ROOT_PATH,
  SKILL_PAGE_BYTES,
  type SkillResult,
  type SkillRules,
  type SkillServing,
  type SkillTranslation,
  servesInFull,
  skillDocumentInput,
  skillUriPrefix,
  sourceFileUrl,
  splitFrontMatter,
} from "@skillcdn/core";
import {
  countEntries,
  type Database,
  type DirectoryListing,
  type EntryRecord,
  findSkills,
  getEntry,
  getManifest,
  getSkillsAt,
  getSnapshotDiagnostics,
  listDirectory,
  listEntries,
  listListedSkills,
  listSkillFiles,
  listSkillResources,
  type SnapshotRecord,
  type SnapshotScope,
  type StoredTranslation,
  searchEntries,
  servedEntries,
} from "@skillcdn/db";
import type { SnapshotOutcome, SnapshotService } from "../indexer/snapshot-service.js";

import {
  continuationKey,
  continuationOffset,
  nextContinuation,
  ReaderInputError,
} from "./continuation.js";
import type { Mount } from "./mount-service.js";

export interface MountReaderDependencies {
  readonly database: Database;
  readonly blobStore: BlobStore;
  readonly gitHost: GitHost;
  readonly snapshots: SnapshotService;
  readonly limits: IndexLimits;
}

/** The index of the commit is not there to answer from: still being built, or the build failed. */
export type NotReady = Exclude<SnapshotOutcome, { status: "ready" }>;

export type SkillLookup =
  | { readonly kind: "found"; readonly skill: SkillResult }
  | {
      readonly kind: "not_found";
      readonly available: readonly string[];
      /** What could not be read: the skill asked for may be among them. */
      readonly diagnostics: readonly IndexDiagnostic[];
    }
  | { readonly kind: "ambiguous"; readonly directories: readonly string[] }
  /** Indexed, but its body is not in the blob store. */
  | { readonly kind: "unavailable" };

export type FileLookup =
  | { readonly kind: "found"; readonly file: FileResult }
  | { readonly kind: "not_ready"; readonly outcome: NotReady }
  /** The path names a directory: its entries are the answer. */
  | { readonly kind: "directory"; readonly directory: DirectoryResult }
  | { readonly kind: "invalid_path"; readonly reason: string }
  | {
      readonly kind: "not_found";
      readonly path: RepoPath;
      readonly suggestions?: readonly string[];
    }
  | {
      readonly kind: "too_large";
      readonly path: RepoPath;
      readonly size: number;
      readonly limit: number;
    }
  | { readonly kind: "not_text"; readonly path: RepoPath }
  /** The license allows a description of the file's skill or repository, not a copy (ADR-0026). */
  | {
      readonly kind: "not_served";
      readonly path: RepoPath;
      readonly license: LicenseFact;
      readonly sourceUrl: string;
    };

export interface SkillListing {
  readonly name: string;
  readonly directory: RepoPath;
  readonly description: string;
  readonly warnings: readonly string[];
  readonly translations: Readonly<Record<string, SkillTranslation>>;
}

/** The repository manifest that governs a mount, as read from the index and the blob store. */
export interface MountManifest {
  /** Relative to the mounted root; `undefined` when the manifest lies above the mount. */
  readonly path: RepoPath | undefined;
  readonly name: string | undefined;
  readonly description: string;
  /** The tag of the language the repository says it is written in. */
  readonly language: string | undefined;
  readonly translations: Readonly<Record<string, RepoTranslation>>;
  /** The Markdown after the front-matter, trimmed: the rules. Empty when there are none. */
  readonly rules: string;
}

export interface MountOverview {
  readonly overview?: FolderOverview;
  readonly groups?: readonly BrowseEntry[];
  readonly mount: MountSummary;
  readonly manifest: MountManifest | undefined;
  /** The license that governs the mounted directory outside its skills (ADR-0026). */
  readonly license: LicenseFact;
  readonly skillCount: number;
  readonly documentCount: number;
  readonly skills: readonly SkillListing[];
  readonly documents: readonly Extract<FindItem, { kind: "document" }>[];
  readonly diagnostics: readonly IndexDiagnostic[];
}

/**
 * What a read is scoped to: the snapshot, and the version of the reading rules its index was
 * written with. A rebuilt index keeps its snapshot id, so everything cached keys on both.
 */
interface ReadScope extends SnapshotScope {
  readonly indexVersion: number;
}
const scopeOf = (snapshot: SnapshotRecord): ReadScope => ({
  accountId: snapshot.accountId,
  snapshotId: snapshot.id,
  indexVersion: snapshot.indexVersion,
});

/** One entry of `skills/list`, as the MCP skills extension defines it. */
export interface SkillEntry {
  readonly uri: string;
  readonly frontmatter: Record<string, unknown>;
  readonly resources: readonly {
    readonly uri: string;
    readonly digest: string;
    readonly size: number;
  }[];
}

export interface SkillsPage {
  readonly skills: readonly SkillEntry[];
  readonly nextCursor: string | undefined;
  readonly total: number;
}

/** What `resources/read` answers: text or bytes, and the digest the listing declared. */
export interface Resource {
  readonly uri: string;
  readonly mimeType: string;
  readonly text?: string;
  readonly blob?: string;
  readonly digest: string;
}

export interface ResourceEntry {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
}

/** Skills per page of `skills/list`; a page is a whole number of entries. */
const SKILLS_PAGE_SIZE = 20;

const MIME_TYPES: Readonly<Record<string, string>> = {
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  xml: "application/xml",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/x-typescript",
  py: "text/x-python",
  sh: "application/x-sh",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** A media type from the extension, else by whether the bytes are text. */
function mimeTypeOf(path: RepoPath, isText: boolean): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return MIME_TYPES[extension] ?? (isText ? "text/plain" : "application/octet-stream");
}

const MAX_LISTED_SKILL_FILES = 50;
const MAX_SUGGESTED_SKILLS = 20;
const MAX_CACHED_TREES = 8;
const MAX_CACHED_CATALOGS = 64;
const MAX_CACHED_MANIFESTS = 64;
const MAX_DIRECTORY_ENTRIES = 200;

/** Keeps a bounded number of promises by key; the oldest goes first. */
function remember<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  limit: number,
  loading: Promise<T>,
) {
  loading.catch(() => {
    cache.delete(key);
  });
  cache.set(key, loading);
  if (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

/** Fit a complete prefix and advance by what was returned, never by the requested limit. */
function boundedPage<T>(
  maximum: number,
  make: (count: number) => T,
  fits?: (page: T) => boolean,
): T {
  const full = make(maximum);
  if (fits === undefined || fits(full)) return full;
  let low = 0;
  let high = maximum - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(make(middle))) low = middle;
    else high = middle - 1;
  }
  const result = make(low);
  if ((maximum > 0 && low === 0) || !fits(result)) {
    throw new ReaderInputError(
      "This result cannot fit a context page. Use a narrower folder or an exact file path.",
    );
  }
  return result;
}

function skillTranslationsOf(
  stored: Readonly<Record<string, StoredTranslation>> | undefined,
): Readonly<Record<string, SkillTranslation>> {
  const translations: Record<string, SkillTranslation> = Object.create(null);
  for (const [tag, entry] of Object.entries(stored ?? {})) {
    translations[tag] = { title: entry.title, description: entry.description };
  }
  return translations;
}

function repoTranslationsOf(
  stored: Readonly<Record<string, StoredTranslation>> | undefined,
): Readonly<Record<string, RepoTranslation>> {
  const translations: Record<string, RepoTranslation> = Object.create(null);
  for (const [tag, entry] of Object.entries(stored ?? {})) {
    translations[tag] = { name: entry.name, description: entry.description };
  }
  return translations;
}

/**
 * Answers questions about one resolved mount as data. The MCP tools render these answers as text
 * for a model and the REST API returns them as JSON, so both always say the same thing.
 */
export class MountReader {
  readonly #dependencies: MountReaderDependencies;
  readonly #entries = new Map<string, Promise<readonly EntryRecord[]>>();

  #entriesOf(scope: ReadScope): Promise<readonly EntryRecord[]> {
    const key = `${scope.accountId} ${scope.snapshotId} ${scope.indexVersion}`;
    let loading = this.#entries.get(key);
    if (loading === undefined) {
      loading = servedEntries(this.#dependencies.database, scope);
      remember(this.#entries, key, MAX_CACHED_TREES, loading);
    }
    return loading;
  }

  #scopePath(mount: Mount, wanted: string | undefined): RepoPath {
    const parsed = parseRepoPath(wanted ?? mount.address.path);
    if (!parsed.ok || !isWithinRepoPath(mount.address.path, parsed.value)) {
      throw new ReaderInputError("Use a repository-root path inside the mounted folder.");
    }
    return parsed.value;
  }

  #pageKey(
    mount: Mount,
    snapshot: SnapshotRecord,
    operation: string,
    path: string,
    query = "",
  ): string {
    return continuationKey([
      snapshot.id,
      snapshot.indexVersion,
      mount.address.path,
      operation,
      path,
      query,
    ]);
  }

  async #references(
    mount: Mount,
    scope: ReadScope,
    references: readonly { href: string; path: string }[],
  ): Promise<FileReference[]> {
    const entries = await this.#entriesOf(scope);
    const available = new Set(entries.map((entry) => entry.path));
    return references.map((reference) => {
      const path = parseRepoPath(reference.path);
      return {
        ...reference,
        status: !path.ok
          ? "blocked"
          : !isWithinRepoPath(mount.address.path, path.value)
            ? "outside_mount"
            : available.has(reference.path)
              ? "available"
              : "missing",
      };
    });
  }

  async #catalogFiles(scope: ReadScope): Promise<CatalogFile[]> {
    const rows = await this.#entriesOf(scope);
    return rows.map((row) => ({
      path: row.path as RepoPath,
      kind: row.kind,
      name: row.name ?? undefined,
      title: row.title ?? undefined,
      description: row.description ?? undefined,
      skillDir: row.skillDir === null ? undefined : (row.skillDir as RepoPath),
      searchable: row.searchable,
      size: row.size,
      linkedOnly: row.frontMatter?.linkedOnly,
      overviewOnly: row.frontMatter?.overviewOnly,
      language: row.frontMatter?.language,
      license: row.frontMatter?.licenseFact,
    }));
  }

  async #browseEntries(scope: ReadScope, path: RepoPath): Promise<BrowseEntry[]> {
    return browseCatalogFiles(await this.#catalogFiles(scope), path);
  }

  /** The license of the skill that owns a path, when one does. */
  async #skillLicenseAt(scope: ReadScope, path: RepoPath): Promise<LicenseFact | undefined> {
    const owner = (await this.#entriesOf(scope))
      .filter(
        (row) =>
          row.kind === "skill" &&
          row.skillDir !== null &&
          isWithinRepoPath(row.skillDir as RepoPath, path),
      )
      .sort((a, b) => (b.skillDir?.length ?? 0) - (a.skillDir?.length ?? 0))[0];
    return owner?.frontMatter?.licenseFact;
  }

  /** The license that governs a path: its skill's own, else the repository's (ADR-0026). */
  async #licenseAt(
    scope: ReadScope,
    snapshot: SnapshotRecord,
    path: RepoPath,
  ): Promise<LicenseFact> {
    const owned = await this.#skillLicenseAt(scope, path);
    if (owned !== undefined) return owned;
    const entries = (await this.#entriesOf(scope)).map((row) => ({
      path: row.path,
      kind: row.kind,
      license: row.frontMatter?.license,
    }));
    return licenseOfPath(entries, path, snapshot.license ?? NO_LICENSE);
  }

  /** Where a file can be read at the host, for a reader sent to the source. */
  #sourceUrl(mount: Mount, path: RepoPath): string {
    const { repository } = mount.repo;
    return sourceFileUrl(
      { host: mount.coordinates.host, owner: repository.owner.login, name: repository.name },
      mount.commit,
      path,
    );
  }

  async #overviewOf(scope: ReadScope, path: RepoPath): Promise<FolderOverview | undefined> {
    const files = await this.#catalogFiles(scope);
    const overview = folderOverview(files, path);
    if (overview === undefined) return undefined;
    const manifest = files.find(
      (file) => file.kind === "manifest" && parentDirectory(file.path) === path,
    );
    return {
      ...overview,
      title: manifest?.name ?? overview.title,
      description: manifest?.description ?? overview.description,
    };
  }

  async browse(
    mount: Mount,
    input: {
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
    waitMs: number,
    fits?: (result: BrowseResult) => boolean,
  ): Promise<NotReady | { readonly status: "ready"; readonly result: BrowseResult }> {
    const path = this.#scopePath(mount, input.path);
    const outcome = await this.#dependencies.snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") return outcome;
    const scope = scopeOf(outcome.snapshot);
    const key = this.#pageKey(mount, outcome.snapshot, "browse", path);
    const offset = continuationOffset(input.cursor, key);
    const entries = (await this.#browseEntries(scope, path)).map((entry) =>
      entry.license !== undefined && !servesInFull(entry.license, mount.verified)
        ? { ...entry, describedOnly: true }
        : entry,
    );
    const limit = input.limit ?? BROWSE_DEFAULT_LIMIT;
    const overview = await this.#overviewOf(scope, path);
    const diagnostics = await this.#diagnosticsOf(mount, scope);
    const make = (count: number): BrowseResult => ({
      mount: this.summary(mount, outcome.snapshot),
      path,
      overview,
      entries: entries.slice(offset, offset + count),
      nextCursor:
        offset + count < entries.length ? nextContinuation(key, offset + count) : undefined,
      diagnostics,
    });
    return {
      status: "ready",
      result: boundedPage(Math.min(limit, Math.max(0, entries.length - offset)), make, fits),
    };
  }
  /**
   * What each mount holds, by snapshot and mounted path, for every connection to read. A
   * snapshot never changes, so neither does this; the map is small and only saves queries.
   */
  readonly #catalogs = new Map<string, Promise<Omit<MountCatalog, "mount">>>();
  /** The manifest of each mount, by snapshot and mounted path. Read once, kept while wanted. */
  readonly #manifests = new Map<string, Promise<MountManifest | undefined>>();

  constructor(dependencies: MountReaderDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * The repository manifest that governs a mount: the one in the mounted directory, else the
   * nearest above it. Its rules come from the blob store, so that `get` can hand them over.
   */
  #manifestOf(mount: Mount, scope: ReadScope): Promise<MountManifest | undefined> {
    const key = `${scope.snapshotId} ${scope.indexVersion} ${mount.address.path}`;
    const cached = this.#manifests.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const { database, blobStore } = this.#dependencies;
    const loading = getManifest(database, scope, mount.address.path).then(async (row) => {
      if (row === undefined || row.description === null) {
        return undefined;
      }
      const text = await blobStore.read(row.blobSha);
      const split = text === undefined ? undefined : splitFrontMatter(text);
      const ancestors = (await this.#entriesOf(scope))
        .filter(
          (entry) =>
            entry.kind === "manifest" &&
            isWithinRepoPath(parentDirectory(entry.path as RepoPath), mount.address.path),
        )
        .sort((a, b) => b.path.length - a.path.length);
      return {
        path: parseRepoPath(row.path).ok ? (row.path as RepoPath) : undefined,
        name: row.name ?? undefined,
        description: row.description,
        language: ancestors.find((entry) => entry.frontMatter?.language !== undefined)?.frontMatter
          ?.language,
        translations: repoTranslationsOf(row.frontMatter?.translations),
        rules: split?.kind === "found" ? split.body.trim() : "",
      };
    });
    remember(this.#manifests, key, MAX_CACHED_MANIFESTS, loading);
    return loading;
  }

  /** The manifests inside the mount that could not be read. Findings above the mount are not ours. */
  async #diagnosticsOf(mount: Mount, scope: ReadScope): Promise<IndexDiagnostic[]> {
    const all = await getSnapshotDiagnostics(this.#dependencies.database, scope);
    return all.flatMap((diagnostic) => {
      const below = belowMount(mount, diagnostic.path);
      return below === undefined
        ? []
        : [{ path: below, code: diagnostic.code, message: diagnostic.message }];
    });
  }

  /**
   * What a client is told when it connects: the skills of the mount and how much else there is.
   * Never waits for the index; a commit that is not indexed yet says so instead.
   */
  async catalog(mount: Mount): Promise<CatalogState> {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, 0);
    if (outcome.status !== "ready") {
      return {
        status: outcome.status,
        mount: this.summary(mount, undefined),
        description: mount.repo.repository.description,
      };
    }
    const scope = scopeOf(outcome.snapshot);
    const path = mount.address.path;
    const key = `${scope.snapshotId} ${scope.indexVersion} ${path}`;
    let loading = this.#catalogs.get(key);
    if (loading === undefined) {
      loading = Promise.all([
        listEntries(database, scope, path, FIND_LIST_SKILLS_MAX, "skills"),
        countEntries(database, scope, path),
        this.#manifestOf(mount, scope),
        this.#diagnosticsOf(mount, scope),
      ]).then(async ([skills, counts, manifest, diagnostics]) => ({
        overview: await this.#overviewOf(scope, path),
        description: mount.repo.repository.description,
        groups: (await this.#browseEntries(scope, path)).slice(0, BROWSE_DEFAULT_LIMIT),
        manifest:
          manifest === undefined
            ? undefined
            : {
                name: manifest.name,
                description: manifest.description,
                path: manifest.path,
                hasRules: manifest.rules.length > 0,
                language: manifest.language,
              },
        skills: skills.flatMap((row) => {
          const directory = belowMount(mount, row.skillDir);
          return directory === undefined || row.name === null
            ? []
            : [{ name: row.name, directory, description: row.description ?? "" }];
        }),
        skillCount: counts.skills,
        documentCount: counts.documents,
        diagnostics,
      }));
      remember(this.#catalogs, key, MAX_CACHED_CATALOGS, loading);
    }
    return {
      status: "ready",
      catalog: { mount: this.summary(mount, outcome.snapshot), ...(await loading) },
    };
  }

  summary(mount: Mount, snapshot: SnapshotRecord | undefined): MountSummary {
    return {
      repository: `${mount.repo.repository.owner.login}/${mount.repo.repository.name}`,
      ref:
        mount.address.ref === undefined
          ? undefined
          : mount.address.ref.kind === "commit"
            ? mount.address.ref.hash
            : mount.address.ref.name,
      commit: mount.commit,
      path: mount.address.path,
      verified: mount.verified,
      truncated: snapshot?.truncated ?? false,
      skillUri: skillUriPrefix(mount.address),
    };
  }

  // The MCP skills extension (ADR-0024): the same index, served as skills and resources.

  /**
   * The repository-root path a skill URI names inside this mount, or `undefined` when the URI
   * is not one of this repository's. A root skill's files carry its name as a directory segment
   * the repository does not have; a real path of that spelling comes first.
   */
  async #pathOfUri(mount: Mount, scope: ReadScope, uri: string): Promise<RepoPath | undefined> {
    const parsed = parseSkillUri(uri);
    if (
      parsed === undefined ||
      parsed.address.host !== mount.address.host ||
      parsed.address.owner !== mount.address.owner ||
      parsed.address.repo !== mount.address.repo
    ) {
      return undefined;
    }
    const root = await this.#rootSkill(scope);
    if (root !== undefined && (parsed.path === root || parsed.path.startsWith(`${root}/`))) {
      const real = await getEntry(this.#dependencies.database, scope, parsed.path);
      if (real === undefined) {
        const below = parsed.path === root ? ROOT_PATH : parsed.path.slice(root.length + 1);
        const path = parseRepoPath(below);
        return path.ok ? path.value : undefined;
      }
    }
    return parsed.path;
  }

  /** The name of the skill at the repository root, when there is one. */
  async #rootSkill(scope: ReadScope): Promise<string | undefined> {
    const root = await getEntry(this.#dependencies.database, scope, "SKILL.md");
    return root?.kind === "skill" && root.name !== null ? root.name : undefined;
  }

  /** The URI of a repository-root path, with a root skill's name segment in front. */
  #uriOf(mount: Mount, root: string | undefined, path: RepoPath): string {
    const named = root === undefined ? path : joinRepoPath(root as RepoPath, path);
    return formatSkillUri(mount.address, named);
  }

  /** What the listing says about one listed skill: its URI, its front matter and its files. */
  async #skillEntry(
    mount: Mount,
    scope: ReadScope,
    root: string | undefined,
    skill: EntryRecord,
  ): Promise<SkillEntry | undefined> {
    const { database, blobStore } = this.#dependencies;
    const text = await blobStore.read(skill.blobSha);
    const split = text === undefined ? undefined : splitFrontMatter(text);
    const fields = split?.kind === "found" ? parseFrontMatter(split.source) : undefined;
    if (fields === undefined || !fields.ok) return undefined;
    const files = await listSkillResources(database, scope, skill.skillDir ?? "");
    return {
      uri: this.#uriOf(mount, root, skill.path as RepoPath),
      frontmatter: frontMatterObject(fields.value),
      resources: files.flatMap((file) =>
        file.digest === null || file.servedSize === null
          ? []
          : [
              {
                uri: this.#uriOf(mount, root, file.path as RepoPath),
                digest: `sha256:${file.digest}`,
                size: file.servedSize,
              },
            ],
      ),
    };
  }

  /** A page of the skills the extension lists inside the mount. */
  async listSkills(
    mount: Mount,
    input: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    waitMs: number,
  ): Promise<NotReady | { readonly status: "ready"; readonly result: SkillsPage }> {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") return outcome;
    const scope = scopeOf(outcome.snapshot);
    const key = this.#pageKey(mount, outcome.snapshot, "skills/list", mount.address.path);
    const offset = continuationOffset(input.cursor, key);
    const limit = input.limit ?? SKILLS_PAGE_SIZE;
    const [root, page] = await Promise.all([
      this.#rootSkill(scope),
      listListedSkills(database, scope, mount.address.path, offset, limit, {
        includeRestricted: mount.verified,
      }),
    ]);
    const skills = (
      await Promise.all(page.skills.map((skill) => this.#skillEntry(mount, scope, root, skill)))
    ).filter((entry) => entry !== undefined);
    return {
      status: "ready",
      result: {
        skills,
        nextCursor:
          offset + page.skills.length < page.total
            ? nextContinuation(key, offset + page.skills.length)
            : undefined,
        total: page.total,
      },
    };
  }

  /** One listed skill by URI; `undefined` when the URI names no listed skill of this mount. */
  async getSkill(
    mount: Mount,
    uri: string,
    waitMs: number,
  ): Promise<NotReady | { readonly status: "ready"; readonly skill: SkillEntry | undefined }> {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") return outcome;
    const scope = scopeOf(outcome.snapshot);
    const path = await this.#pathOfUri(mount, scope, uri);
    const entry =
      path === undefined || !isWithinRepoPath(mount.address.path, path)
        ? undefined
        : await getEntry(database, scope, path);
    if (entry?.kind !== "skill" || !entry.listed) return { status: "ready", skill: undefined };
    // A described skill is not listed here, so its URI names nothing (ADR-0026).
    if (!servesInFull(entry.frontMatter?.licenseFact ?? NO_LICENSE, mount.verified)) {
      return { status: "ready", skill: undefined };
    }
    return {
      status: "ready",
      skill: await this.#skillEntry(mount, scope, await this.#rootSkill(scope), entry),
    };
  }

  /** The bytes a URI names, as the listing digested them; `undefined` when it names nothing served. */
  async readResource(
    mount: Mount,
    uri: string,
    waitMs: number,
  ): Promise<NotReady | { readonly status: "ready"; readonly resource: Resource | undefined }> {
    const { database, blobStore, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") return outcome;
    const scope = scopeOf(outcome.snapshot);
    const path = await this.#pathOfUri(mount, scope, uri);
    const entry =
      path === undefined || !isWithinRepoPath(mount.address.path, path)
        ? undefined
        : await getEntry(database, scope, path);
    if (entry === undefined || entry.digest === null)
      return { status: "ready", resource: undefined };
    const license = await this.#licenseAt(scope, outcome.snapshot, entry.path as RepoPath);
    if (!servesInFull(license, mount.verified)) return { status: "ready", resource: undefined };
    if (entry.kind === "skill") {
      const document = await this.#assembledDocument(mount, scope, entry);
      return {
        status: "ready",
        resource:
          document === undefined
            ? undefined
            : { uri, mimeType: "text/markdown", text: document, digest: entry.digest },
      };
    }
    const bytes = await blobStore.readBytes(entry.blobSha);
    if (bytes === undefined) return { status: "ready", resource: undefined };
    const text = decodeText(bytes);
    return {
      status: "ready",
      resource: {
        uri,
        mimeType: mimeTypeOf(entry.path as RepoPath, text !== undefined),
        ...(text === undefined ? { blob: Buffer.from(bytes).toString("base64") } : { text }),
        digest: entry.digest,
      },
    };
  }

  /** The direct children of a directory URI, or `undefined` when it names no directory served here. */
  async readDirectory(
    mount: Mount,
    uri: string,
    waitMs: number,
  ): Promise<
    NotReady | { readonly status: "ready"; readonly entries: readonly ResourceEntry[] | undefined }
  > {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") return outcome;
    const scope = scopeOf(outcome.snapshot);
    const root = await this.#rootSkill(scope);
    const path = await this.#pathOfUri(mount, scope, uri);
    if (path === undefined || !isWithinRepoPath(mount.address.path, path)) {
      return { status: "ready", entries: undefined };
    }
    const owned = await this.#skillLicenseAt(scope, path);
    if (owned !== undefined && !servesInFull(owned, mount.verified)) {
      return { status: "ready", entries: undefined };
    }
    const children = await listDirectory(database, scope, path, MAX_DIRECTORY_ENTRIES);
    if (children.length === 0) return { status: "ready", entries: undefined };
    return {
      status: "ready",
      entries: children.map((child) => ({
        uri: this.#uriOf(mount, root, child.path as RepoPath),
        name: child.path.slice(child.path.lastIndexOf("/") + 1),
        mimeType:
          child.kind === "directory" ? "inode/directory" : mimeTypeOf(child.path as RepoPath, true),
      })),
    };
  }

  /** The document a listed skill's `SKILL.md` is served as, assembled as it was digested. */
  async #assembledDocument(
    mount: Mount,
    scope: ReadScope,
    skill: EntryRecord,
  ): Promise<string | undefined> {
    const { database, blobStore } = this.#dependencies;
    const text = await blobStore.read(skill.blobSha);
    if (text === undefined || skill.skillDir === null) return undefined;
    const directory = skill.skillDir as RepoPath;
    const manifests = (await this.#entriesOf(scope))
      .filter(
        (row) =>
          row.kind === "manifest" &&
          row.frontMatter?.manifestError === undefined &&
          isWithinRepoPath(parentDirectory(row.path as RepoPath), directory),
      )
      .sort((a, b) => a.path.length - b.path.length);
    const rules = await Promise.all(
      manifests.map(async (row) => ({
        path: row.path as RepoPath,
        text: await blobStore.read(row.blobSha),
      })),
    );
    const included = await Promise.all(
      (skill.frontMatter?.include ?? []).map(async (relative) => {
        const parsed = parseRepoPath(relative);
        const path = parsed.ok ? joinRepoPath(directory, parsed.value) : undefined;
        const entry = path === undefined ? undefined : await getEntry(database, scope, path);
        return {
          path: path ?? directory,
          text: entry === undefined ? undefined : await blobStore.read(entry.blobSha),
        };
      }),
    );
    if (
      rules.some((rule) => rule.text === undefined) ||
      included.some((file) => file.text === undefined)
    ) {
      return undefined;
    }
    const input = skillDocumentInput({
      commit: mount.commit,
      skill: { path: skill.path as RepoPath, text },
      manifests: rules.map((rule) => ({ path: rule.path, text: rule.text ?? "" })),
      included: included.map((file) => ({ path: file.path, text: file.text ?? "" })),
    });
    return input === undefined ? undefined : assembleSkillDocument(input);
  }

  async find(
    mount: Mount,
    input: {
      readonly query?: string | undefined;
      readonly limit?: number | undefined;
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
    },
    waitMs: number,
    fits?: (result: FindResult) => boolean,
  ): Promise<NotReady | { readonly status: "ready"; readonly result: FindResult }> {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const scope = scopeOf(outcome.snapshot);
    const trimmed = input.query?.trim();
    const query = trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
    const limit = input.limit ?? FIND_DEFAULT_LIMIT;
    const path = this.#scopePath(mount, input.path);
    const key = this.#pageKey(mount, outcome.snapshot, "search", path, query ?? "");
    const offset = continuationOffset(input.cursor, key);
    let items: FindItem[];
    let totals: FindResult["totals"];
    if (query === undefined) {
      // A listing names every skill: a skill's own files are reached through the skill.
      const [skills, documents, counts] = await Promise.all([
        listEntries(database, scope, path, Number.MAX_SAFE_INTEGER, "skills"),
        listEntries(database, scope, path, Number.MAX_SAFE_INTEGER, "documents_outside_skills"),
        countEntries(database, scope, path),
      ]);
      items = [...skills, ...documents]
        .map((row) => toFindItem(mount, row))
        .filter((item) => item !== undefined);
      totals = counts;
    } else {
      const rows = await searchEntries(database, scope, path, query);
      items = await this.#fold({ ...mount, address: { ...mount.address, path } }, scope, rows);
      totals = undefined;
    }
    const diagnostics = await this.#diagnosticsOf(mount, scope);
    const make = (count: number): FindResult => ({
      mount: this.summary(mount, outcome.snapshot),
      query,
      items: items.slice(offset, offset + count),
      path,
      nextCursor: offset + count < items.length ? nextContinuation(key, offset + count) : undefined,
      totals,
      diagnostics,
    });
    return {
      status: "ready",
      result: boundedPage(Math.min(limit, Math.max(0, items.length - offset)), make, fits),
    };
  }

  /**
   * Search results in rank order, with the files of a skill folded under the skill: the skill
   * takes the place of its best-ranked member, so that a model loads the skill rather than a
   * fragment of it. A skill whose files matched, but that did not match itself, is looked up.
   */
  async #fold(mount: Mount, scope: ReadScope, rows: readonly EntryRecord[]): Promise<FindItem[]> {
    interface Group {
      skill: EntryRecord | undefined;
      readonly files: EntryRecord[];
    }
    const groups = new Map<string, Group>();
    const order: ({ readonly group: string } | { readonly row: EntryRecord })[] = [];
    for (const row of rows) {
      const owner = row.skillDir;
      if (owner === null || belowMount(mount, owner) === undefined) {
        order.push({ row });
        continue;
      }
      let group = groups.get(owner);
      if (group === undefined) {
        group = { skill: undefined, files: [] };
        groups.set(owner, group);
        order.push({ group: owner });
      }
      if (row.kind === "skill") {
        group.skill = row;
      } else {
        group.files.push(row);
      }
    }
    const unmatched = [...groups]
      .filter(([, group]) => group.skill === undefined)
      .map(([directory]) => directory);
    for (const row of await getSkillsAt(this.#dependencies.database, scope, unmatched)) {
      const group = row.skillDir === null ? undefined : groups.get(row.skillDir);
      if (group !== undefined) {
        group.skill = row;
      }
    }

    const items: FindItem[] = [];
    const push = (row: EntryRecord): void => {
      const item = toFindItem(mount, row);
      if (item !== undefined) {
        items.push(item);
      }
    };
    for (const entry of order) {
      if ("row" in entry) {
        push(entry.row);
        continue;
      }
      const group = groups.get(entry.group);
      const skill = group?.skill === undefined ? undefined : toFindItem(mount, group.skill);
      if (group === undefined || skill === undefined || skill.kind !== "skill") {
        // The skill itself is out of reach: its files stand on their own and say whose they are.
        for (const row of group?.files ?? []) {
          push(row);
        }
        continue;
      }
      const files = group.files.flatMap((row): FindFile[] => {
        const path = belowMount(mount, row.path);
        return path === undefined
          ? []
          : [{ path, title: row.title ?? undefined, summary: row.description ?? undefined }];
      });
      items.push({
        ...skill,
        files: files.slice(0, FIND_MAX_SKILL_FILES),
        moreFiles: Math.max(0, files.length - FIND_MAX_SKILL_FILES),
      });
    }
    return items;
  }

  async skill(
    mount: Mount,
    wanted: string,
    waitMs: number,
    cursor?: string,
    exactPath = false,
    fits?: (result: SkillResult) => boolean,
  ): Promise<NotReady | { readonly status: "ready"; readonly lookup: SkillLookup }> {
    const { database, blobStore, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const scope = scopeOf(outcome.snapshot);
    const name = exactPath ? wanted : wanted.trim();
    const asDirectory = parseRepoPath(name);
    const directory =
      asDirectory.ok && isWithinRepoPath(mount.address.path, asDirectory.value)
        ? asDirectory.value
        : undefined;
    const byPath = directory === undefined ? undefined : await getEntry(database, scope, directory);
    const found =
      byPath?.kind === "skill"
        ? [byPath]
        : exactPath
          ? []
          : await findSkills(database, scope, mount.address.path, { name, directory }, 10);
    const exact = found.filter((row) => row.name === name || row.skillDir === directory);
    const matches = exact.length > 0 ? exact : found;

    if (matches.length === 0) {
      const [listed, diagnostics] = await Promise.all([
        listEntries(database, scope, mount.address.path, MAX_SUGGESTED_SKILLS, "skills"),
        this.#diagnosticsOf(mount, scope),
      ]);
      const available = listed.flatMap((row) => (row.name === null ? [] : [row.path]));
      return { status: "ready", lookup: { kind: "not_found", available, diagnostics } };
    }
    const [skill, ...others] = matches;
    if (skill === undefined || others.length > 0) {
      return {
        status: "ready",
        lookup: {
          kind: "ambiguous",
          directories: matches.map((row) => belowMount(mount, row.skillDir) ?? "."),
        },
      };
    }

    const skillDirectory = belowMount(mount, skill.skillDir);
    if (skillDirectory === undefined || skill.name === null) {
      return { status: "ready", lookup: { kind: "unavailable" } };
    }
    const skillName = skill.name;
    const license = skill.frontMatter?.licenseFact ?? NO_LICENSE;
    const serving: SkillServing = {
      license,
      full: servesInFull(license, mount.verified),
      sourceUrl: this.#sourceUrl(mount, skill.path as RepoPath),
    };
    if (!serving.full) {
      // The license lets the reader know that the skill exists and where; the rest stays at the
      // source (ADR-0026).
      return {
        status: "ready",
        lookup: {
          kind: "found",
          skill: {
            mount: this.summary(mount, outcome.snapshot),
            path: skill.path as RepoPath,
            ruleChain: [],
            references: [],
            complete: true,
            nextCursor: undefined,
            name: skillName,
            directory: skillDirectory,
            description: skill.description ?? "",
            license: skill.frontMatter?.license,
            compatibility: skill.frontMatter?.compatibility,
            allowedTools: skill.frontMatter?.allowedTools,
            metadata: skill.frontMatter?.metadata ?? {},
            body: "",
            files: [],
            filesTruncated: false,
            included: [],
            warnings: [...(skill.frontMatter?.warnings ?? [])],
            rules: undefined,
            translations: skillTranslationsOf(skill.frontMatter?.translations),
            serving,
          },
        },
      };
    }
    const text = await blobStore.read(skill.blobSha);
    if (text === undefined) {
      return { status: "ready", lookup: { kind: "unavailable" } };
    }
    const split = splitFrontMatter(text);
    const [files, entries, included] = await Promise.all([
      listSkillFiles(database, scope, skill.skillDir ?? "", MAX_LISTED_SKILL_FILES + 1),
      this.#entriesOf(scope),
      this.#includedFiles(mount, scope, skill.skillDir ?? "", skill.frontMatter?.include ?? []),
    ]);
    const ancestors = entries
      .filter(
        (row) =>
          row.kind === "manifest" &&
          isWithinRepoPath(parentDirectory(row.path as RepoPath), skillDirectory),
      )
      .sort((a, b) => a.path.length - b.path.length);
    const ruleChain: SkillRules[] = [];
    const warnings = [...(skill.frontMatter?.warnings ?? [])];
    let rulesComplete = true;
    for (const ancestor of ancestors) {
      const body =
        ancestor.frontMatter?.manifestError === undefined
          ? await blobStore.read(ancestor.blobSha)
          : undefined;
      if (body === undefined) {
        rulesComplete = false;
        warnings.push(
          `Applicable rules unavailable: ${ancestor.path}. Read or repair this manifest before using the skill.`,
        );
        continue;
      }
      const parsed = splitFrontMatter(body);
      if (parsed.kind === "found" && parsed.body.trim().length > 0)
        ruleChain.push({
          path: ancestor.path as RepoPath,
          body: parsed.body.trim(),
          truncated: false,
        });
    }
    const contextAvailable = rulesComplete && included.every((file) => file.content !== undefined);
    for (const file of included) {
      if (file.content === undefined) {
        warnings.push(
          `Required file unavailable in this snapshot: ${file.path}. It must be indexed and readable before using the skill.`,
        );
      }
    }
    const key = this.#pageKey(mount, outcome.snapshot, "get_skill", skill.path);
    const start = continuationOffset(cursor, key);
    const referenceSources = [
      skill,
      ...ancestors,
      ...entries.filter((entry) => included.some((file) => file.path === entry.path)),
    ];
    const references = await this.#references(
      mount,
      scope,
      referenceSources.flatMap((entry) =>
        (entry.frontMatter?.references ?? []).map((reference) => ({
          ...reference,
          source: entry.path,
        })),
      ),
    );
    const make = (pageBytes: number): SkillResult => {
      let skip = start;
      let remaining = pageBytes;
      let consumed = 0;
      let total = 0;
      const page = (text: string): { content: string; truncated: boolean } => {
        total += text.length;
        if (skip >= text.length) {
          skip -= text.length;
          return { content: "", truncated: false };
        }
        const offset = skip;
        skip = 0;
        if (remaining <= 0) return { content: "", truncated: text.length > 0 };
        const part = contextPage(text, offset, remaining);
        // A deferred character must precede every later section on the next page.
        remaining = part.more ? 0 : remaining - part.bytes;
        consumed += part.content.length;
        return { content: part.content, truncated: part.more };
      };
      const pagedRules = ruleChain.flatMap((rule) => {
        const part = page(rule.body);
        return part.content.length === 0
          ? []
          : [{ ...rule, body: part.content, truncated: part.truncated }];
      });
      const body = page(split.kind === "found" ? split.body : text).content;
      const pagedIncluded = included.map((file) =>
        file.content === undefined
          ? file
          : (() => {
              const part = page(file.content);
              return { ...file, content: part.content, truncated: part.truncated };
            })(),
      );
      const nextCursor =
        contextAvailable && start + consumed < total
          ? nextContinuation(key, start + consumed)
          : undefined;
      return {
        mount: this.summary(mount, outcome.snapshot),
        path: skill.path as RepoPath,
        ruleChain: pagedRules,
        references,
        complete: contextAvailable && nextCursor === undefined,
        nextCursor,
        name: skillName,
        directory: skillDirectory,
        description: skill.description ?? "",
        license: skill.frontMatter?.license,
        compatibility: skill.frontMatter?.compatibility,
        allowedTools: skill.frontMatter?.allowedTools,
        metadata: skill.frontMatter?.metadata ?? {},
        body,
        files: files
          .slice(0, MAX_LISTED_SKILL_FILES)
          .map((file) => belowMount(mount, file))
          .filter((file) => file !== undefined),
        filesTruncated: files.length > MAX_LISTED_SKILL_FILES,
        included: pagedIncluded,
        warnings,
        rules: pagedRules[0],
        translations: skillTranslationsOf(skill.frontMatter?.translations),
        serving,
      };
    };
    const result = boundedPage(SKILL_PAGE_BYTES, make, fits);
    if (result.nextCursor === nextContinuation(key, start)) {
      throw new ReaderInputError("This context page cannot advance. Read the exact source file.");
    }
    return { status: "ready", lookup: { kind: "found", skill: result } };
  }

  /**
   * Indexed bodies of required files, in declaration order. skill() pages these together with
   * the skill and its rules. Unindexed files stay unavailable even if another read warms a blob.
   */
  async #includedFiles(
    mount: Mount,
    scope: ReadScope,
    skillDir: string,
    include: readonly string[],
  ): Promise<IncludedFile[]> {
    const { database, blobStore } = this.#dependencies;
    const base = parseRepoPath(skillDir);
    const read = await Promise.all(
      include.map(async (relative) => {
        const parsed = parseRepoPath(relative);
        if (!base.ok || !parsed.ok) {
          return undefined;
        }
        const absolute = joinRepoPath(base.value, parsed.value);
        const path = belowMount(mount, absolute);
        if (path === undefined) {
          return undefined;
        }
        const entry = await getEntry(database, scope, absolute);
        const text =
          entry?.kind === "markdown" || entry?.kind === "json"
            ? await blobStore.read(entry.blobSha)
            : undefined;
        return { path, text };
      }),
    );
    const included: IncludedFile[] = [];
    for (const file of read) {
      if (file === undefined) {
        continue;
      }
      if (file.text === undefined) {
        included.push({ path: file.path, content: undefined, truncated: false });
        continue;
      }
      included.push({ path: file.path, content: file.text, truncated: false });
    }
    return included;
  }

  /**
   * Reads a page of a text file, or lists a directory. Never waits for the index: the commit's
   * tree answers meanwhile.
   */
  async file(
    mount: Mount,
    input: {
      readonly path: string;
      readonly offset?: number | undefined;
      readonly limit?: number | undefined;
    },
    fits?: (result: FileResult) => boolean,
  ): Promise<FileLookup> {
    const { database, blobStore, gitHost, snapshots } = this.#dependencies;
    const limits = { ...this.#dependencies.limits, ...mount.limits };
    const wanted = input.path;
    let below: RepoPath;
    if (wanted === "." || wanted === "/") {
      // Nothing else can name the mounted root, since an empty path is not a path.
      below = ROOT_PATH;
    } else {
      const parsed = parseRepoPath(wanted);
      if (!parsed.ok || parsed.value.length === 0) {
        return {
          kind: "invalid_path",
          reason: parsed.ok ? "the path is empty" : parsed.error.message,
        };
      }
      below = parsed.value;
    }
    const path = below;
    if (!isWithinRepoPath(mount.address.path, path)) return { kind: "not_found", path };

    const outcome = await snapshots.ready(mount, 0);
    // Publication policy may exclude any path, including declarations. Never guess before it
    // has been validated; blob-cache availability is not permission to serve a file.
    if (outcome.status !== "ready") return { kind: "not_ready", outcome };
    let file: { readonly size: number; readonly hash: string } | undefined;
    let children: readonly DirectoryListing[] = [];
    const scope = scopeOf(outcome.snapshot);
    const entry = below.length === 0 ? undefined : await getEntry(database, scope, path);
    if (entry?.frontMatter?.manifestError === "unsupported_type")
      return { kind: "not_found", path };
    file = entry === undefined ? undefined : { size: entry.size, hash: entry.blobSha };
    if (file === undefined) {
      children = await listDirectory(database, scope, path, MAX_DIRECTORY_ENTRIES + 1);
    }
    if (file === undefined) {
      const entries = children.flatMap((child) => {
        const childPath = belowMount(mount, child.path);
        return childPath === undefined
          ? []
          : [{ path: childPath, kind: child.kind, size: child.size ?? undefined }];
      });
      if (entries.length === 0) {
        const suggestions = (await this.#entriesOf(scopeOf(outcome.snapshot)))
          .filter(
            (entry) =>
              belowMount(mount, entry.path) !== undefined && entry.path.endsWith(`/${below}`),
          )
          .slice(0, 5)
          .map((entry) => entry.path);
        return { kind: "not_found", path: below, suggestions };
      }
      return {
        kind: "directory",
        directory: {
          mount: this.summary(mount, outcome.status === "ready" ? outcome.snapshot : undefined),
          path: below,
          entries: entries.slice(0, MAX_DIRECTORY_ENTRIES),
          truncated: entries.length > MAX_DIRECTORY_ENTRIES,
        },
      };
    }
    const license = await this.#licenseAt(scope, outcome.snapshot, path);
    if (!servesInFull(license, mount.verified)) {
      return { kind: "not_served", path: below, license, sourceUrl: this.#sourceUrl(mount, path) };
    }
    if (file.size > limits.maxReadableFileBytes) {
      return {
        kind: "too_large",
        path: below,
        size: file.size,
        limit: limits.maxReadableFileBytes,
      };
    }

    let text = await blobStore.read(file.hash);
    if (text === undefined) {
      const bytes = await gitHost.readBlob(
        mount.coordinates,
        file.hash,
        limits.maxReadableFileBytes,
      );
      await blobStore.write(file.hash, bytes);
      text = decodeText(bytes);
      if (text === undefined) {
        return { kind: "not_text", path: below };
      }
    }
    const refsOutcome =
      outcome.status === "ready"
        ? await this.#references(
            mount,
            scopeOf(outcome.snapshot),
            (await getEntry(database, scopeOf(outcome.snapshot), path))?.frontMatter?.references ??
              [],
          )
        : [];
    const make = (length: number): FileResult => ({
      references: refsOutcome,
      mount: this.summary(mount, outcome.status === "ready" ? outcome.snapshot : undefined),
      path: below,
      ...pageOfText(text, input.offset ?? 0, length),
    });
    const page = boundedPage(input.limit ?? READ_FILE_DEFAULT_LIMIT, make, fits);
    if (page.nextOffset !== undefined && page.content.length === 0) {
      throw new ReaderInputError("This file page cannot advance. Use a larger page limit.");
    }
    return { kind: "found", file: page };
  }

  /** Everything the mount offers, up to `listLimit` skills and as many documents. Never waits. */
  async overview(
    mount: Mount,
    listLimit: number,
  ): Promise<NotReady | { readonly status: "ready"; readonly overview: MountOverview }> {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, 0);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const scope = scopeOf(outcome.snapshot);
    const path = mount.address.path;
    const [counts, skills, documents, diagnostics, manifest, groups] = await Promise.all([
      countEntries(database, scope, path),
      listEntries(database, scope, path, listLimit, "skills"),
      listEntries(database, scope, path, listLimit, "documents_outside_skills"),
      this.#diagnosticsOf(mount, scope),
      this.#manifestOf(mount, scope),
      this.#browseEntries(scope, path),
    ]);
    return {
      status: "ready",
      overview: {
        overview: await this.#overviewOf(scope, path),
        mount: this.summary(mount, outcome.snapshot),
        groups: groups.filter((entry) => entry.kind === "directory").slice(0, BROWSE_DEFAULT_LIMIT),
        manifest,
        license: await this.#licenseAt(scope, outcome.snapshot, path),
        skillCount: counts.skills,
        documentCount: counts.documents,
        skills: skills.flatMap((row) => {
          const directory = belowMount(mount, row.skillDir);
          return directory === undefined || row.name === null
            ? []
            : [
                {
                  name: row.name,
                  directory,
                  description: row.description ?? "",
                  warnings: row.frontMatter?.warnings ?? [],
                  translations: skillTranslationsOf(row.frontMatter?.translations),
                },
              ];
        }),
        documents: documents.flatMap((row) => {
          const item = toFindItem(mount, row);
          return item?.kind === "document" ? [item] : [];
        }),
        diagnostics,
      },
    };
  }
}

/** A path stored by the indexer, relative to the mounted root. */
function belowMount(mount: Mount, stored: string | null): RepoPath | undefined {
  const parsed = stored === null ? undefined : parseRepoPath(stored);
  return parsed?.ok === true && isWithinRepoPath(mount.address.path, parsed.value)
    ? parsed.value
    : undefined;
}

function toFindItem(mount: Mount, row: EntryRecord): FindItem | undefined {
  if (row.kind === "skill") {
    const directory = belowMount(mount, row.skillDir);
    return directory === undefined || row.name === null
      ? undefined
      : {
          kind: "skill",
          path: row.path as RepoPath,
          name: row.name,
          directory,
          description: row.description ?? "",
          files: [],
          moreFiles: 0,
          translations: skillTranslationsOf(row.frontMatter?.translations),
          ...(row.frontMatter?.licenseFact === undefined
            ? {}
            : {
                license: row.frontMatter.licenseFact,
                ...(servesInFull(row.frontMatter.licenseFact, mount.verified)
                  ? {}
                  : { describedOnly: true }),
              }),
        };
  }
  const path = belowMount(mount, row.path);
  return path === undefined
    ? undefined
    : {
        kind: "document",
        path,
        title: row.title ?? undefined,
        summary: row.description ?? undefined,
        skillDirectory: belowMount(mount, row.skillDir),
      };
}
