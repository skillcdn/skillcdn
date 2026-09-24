import {
  type BlobStore,
  BROWSE_DEFAULT_LIMIT,
  type BrowseEntry,
  type BrowseResult,
  browseCatalogFiles,
  type CatalogState,
  classifyRepoFile,
  contextPage,
  type DirectoryResult,
  FIND_DEFAULT_LIMIT,
  FIND_LIST_SKILLS_MAX,
  FIND_MAX_SKILL_FILES,
  type FileReference,
  type FileResult,
  type FindFile,
  type FindItem,
  type FindResult,
  type GitHost,
  type IncludedFile,
  type IndexDiagnostic,
  type IndexLimits,
  isHiddenPath,
  isServedPath,
  isWithinRepoPath,
  joinRepoPath,
  type MountCatalog,
  type MountSummary,
  pageOfText,
  parentDirectory,
  parseRepoPath,
  READ_FILE_DEFAULT_LIMIT,
  type RepoPath,
  type RepoTranslation,
  type RepoTree,
  ROOT_PATH,
  type ServedScope,
  SKILL_PAGE_BYTES,
  type SkillResult,
  type SkillRules,
  type SkillTranslation,
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
  listSkillFiles,
  type SnapshotRecord,
  type SnapshotScope,
  type StoredTranslation,
  searchEntries,
  servedEntries,
} from "@skillcdn/db";
import type { SnapshotOutcome, SnapshotService } from "../indexer/snapshot-service.js";
import { decodeText } from "../indexer/text.js";
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
  | { readonly kind: "not_text"; readonly path: RepoPath };

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
  readonly groups?: readonly BrowseEntry[];
  readonly mount: MountSummary;
  readonly manifest: MountManifest | undefined;
  readonly skillCount: number;
  readonly documentCount: number;
  readonly skills: readonly SkillListing[];
  readonly documents: readonly Extract<FindItem, { kind: "document" }>[];
  readonly diagnostics: readonly IndexDiagnostic[];
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

  #entriesOf(scope: SnapshotScope): Promise<readonly EntryRecord[]> {
    const key = `${scope.accountId} ${scope.snapshotId}`;
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
    scope: SnapshotScope,
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

  async #browseEntries(scope: SnapshotScope, path: RepoPath): Promise<BrowseEntry[]> {
    const rows = await this.#entriesOf(scope);
    return browseCatalogFiles(
      rows.map((row) => ({
        path: row.path as RepoPath,
        kind: row.kind,
        name: row.name ?? undefined,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        skillDir: row.skillDir === null ? undefined : (row.skillDir as RepoPath),
        searchable: row.searchable,
        size: row.size,
        linkedOnly: row.frontMatter?.linkedOnly,
        language: row.frontMatter?.language,
      })),
      path,
    );
  }

  async browse(
    mount: Mount,
    input: {
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
    waitMs: number,
  ): Promise<NotReady | { readonly status: "ready"; readonly result: BrowseResult }> {
    const path = this.#scopePath(mount, input.path);
    const outcome = await this.#dependencies.snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") return outcome;
    const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
    const key = this.#pageKey(mount, outcome.snapshot, "browse", path);
    const offset = continuationOffset(input.cursor, key);
    const entries = await this.#browseEntries(scope, path);
    const limit = input.limit ?? BROWSE_DEFAULT_LIMIT;
    return {
      status: "ready",
      result: {
        mount: this.summary(mount, outcome.snapshot),
        path,
        entries: entries.slice(offset, offset + limit),
        nextCursor:
          offset + limit < entries.length ? nextContinuation(key, offset + limit) : undefined,
        diagnostics: await this.#diagnosticsOf(mount, scope),
      },
    };
  }
  /**
   * Trees of commits whose index is not ready yet, so that files can be read in the meantime.
   * A commit's tree never changes; the cache is small and only saves repeated upstream calls.
   */
  readonly #trees = new Map<string, Promise<RepoTree>>();
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
  #manifestOf(mount: Mount, scope: SnapshotScope): Promise<MountManifest | undefined> {
    const key = `${scope.snapshotId} ${mount.address.path}`;
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
  async #diagnosticsOf(mount: Mount, scope: SnapshotScope): Promise<IndexDiagnostic[]> {
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
      return { status: outcome.status, mount: this.summary(mount, undefined) };
    }
    const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
    const path = mount.address.path;
    const key = `${outcome.snapshot.id} ${path}`;
    let loading = this.#catalogs.get(key);
    if (loading === undefined) {
      loading = Promise.all([
        listEntries(database, scope, path, FIND_LIST_SKILLS_MAX, "skills"),
        countEntries(database, scope, path),
        this.#manifestOf(mount, scope),
        this.#diagnosticsOf(mount, scope),
      ]).then(async ([skills, counts, manifest, diagnostics]) => ({
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
    };
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
  ): Promise<NotReady | { readonly status: "ready"; readonly result: FindResult }> {
    const { database, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
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
    return {
      status: "ready",
      result: {
        mount: this.summary(mount, outcome.snapshot),
        query,
        items: items.slice(offset, offset + limit),
        path,
        nextCursor:
          offset + limit < items.length ? nextContinuation(key, offset + limit) : undefined,
        totals,
        diagnostics: await this.#diagnosticsOf(mount, scope),
      },
    };
  }

  /**
   * Search results in rank order, with the files of a skill folded under the skill: the skill
   * takes the place of its best-ranked member, so that a model loads the skill rather than a
   * fragment of it. A skill whose files matched, but that did not match itself, is looked up.
   */
  async #fold(
    mount: Mount,
    scope: SnapshotScope,
    rows: readonly EntryRecord[],
  ): Promise<FindItem[]> {
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
  ): Promise<NotReady | { readonly status: "ready"; readonly lookup: SkillLookup }> {
    const { database, blobStore, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
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

    const text = await blobStore.read(skill.blobSha);
    const skillDirectory = belowMount(mount, skill.skillDir);
    if (text === undefined || skillDirectory === undefined || skill.name === null) {
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
    let skip = continuationOffset(cursor, key);
    const start = skip;
    let remaining = SKILL_PAGE_BYTES;
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
    return {
      status: "ready",
      lookup: {
        kind: "found",
        skill: {
          mount: this.summary(mount, outcome.snapshot),
          path: skill.path as RepoPath,
          ruleChain: pagedRules,
          references,
          complete: contextAvailable && nextCursor === undefined,
          nextCursor,
          name: skill.name,
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
        },
      },
    };
  }

  /**
   * Indexed bodies of required files, in declaration order. skill() pages these together with
   * the skill and its rules. Unindexed files stay unavailable even if another read warms a blob.
   */
  async #includedFiles(
    mount: Mount,
    scope: SnapshotScope,
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
    let file: { readonly size: number; readonly hash: string } | undefined;
    let children: readonly DirectoryListing[] = [];
    if (outcome.status === "ready") {
      const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
      const entry = below.length === 0 ? undefined : await getEntry(database, scope, path);
      file = entry === undefined ? undefined : { size: entry.size, hash: entry.blobSha };
      if (file === undefined) {
        children = await listDirectory(database, scope, path, MAX_DIRECTORY_ENTRIES + 1);
      }
    } else {
      const tree = await this.#treeOf(mount);
      const entry =
        below.length === 0
          ? undefined
          : tree.entries.find((candidate) => candidate.type === "file" && candidate.path === path);
      file = entry === undefined ? undefined : { size: entry.size, hash: entry.hash };
      if (file === undefined) {
        children = directoryOfTree(tree, path, MAX_DIRECTORY_ENTRIES + 1);
      }
    }
    if (file === undefined) {
      const entries = children.flatMap((child) => {
        const childPath = belowMount(mount, child.path);
        return childPath === undefined
          ? []
          : [{ path: childPath, kind: child.kind, size: child.size ?? undefined }];
      });
      if (entries.length === 0) {
        const suggestions =
          outcome.status !== "ready"
            ? []
            : (
                await this.#entriesOf({
                  accountId: outcome.snapshot.accountId,
                  snapshotId: outcome.snapshot.id,
                })
              )
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
      text = decodeText(bytes);
      if (text === undefined) {
        return { kind: "not_text", path: below };
      }
      await blobStore.write(file.hash, text);
    }
    const refsOutcome =
      outcome.status === "ready"
        ? await this.#references(
            mount,
            { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id },
            (
              await getEntry(
                database,
                { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id },
                path,
              )
            )?.frontMatter?.references ?? [],
          )
        : [];
    return {
      kind: "found",
      file: {
        references: refsOutcome,
        mount: this.summary(mount, outcome.status === "ready" ? outcome.snapshot : undefined),
        path: below,
        ...pageOfText(text, input.offset ?? 0, input.limit ?? READ_FILE_DEFAULT_LIMIT),
      },
    };
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
    const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
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
        mount: this.summary(mount, outcome.snapshot),
        groups: groups.filter((entry) => entry.kind === "directory").slice(0, BROWSE_DEFAULT_LIMIT),
        manifest,
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

  #treeOf(mount: Mount): Promise<RepoTree> {
    const key = `${mount.repo.id} ${mount.commit}`;
    const cached = this.#trees.get(key);
    if (cached !== undefined) {
      return cached;
    }
    // Declarations can be inspected before indexing, but their filenames alone cannot publish
    // supporting files. Hidden declarations and declared document roots wait for validation.
    const loading = this.#dependencies.gitHost
      .getTree(mount.coordinates, mount.commit)
      .then((tree) => {
        const files = tree.entries.filter(
          (entry) => entry.type === "file" && !isHiddenPath(entry.path),
        );
        const directoriesOf = (kind: string): Set<RepoPath> =>
          new Set(
            files
              .filter((entry) => classifyRepoFile(entry.path) === kind)
              .map((entry) => parentDirectory(entry.path)),
          );
        const scope: ServedScope = {
          skillDirectories: new Set(),
          manifestDirectories: directoriesOf("manifest"),
          documentDirectories: new Map(),
        };
        return {
          ...tree,
          entries: files.filter((entry) => {
            const kind = classifyRepoFile(entry.path);
            return kind === "skill" || kind === "manifest" || isServedPath(entry.path, scope);
          }),
        };
      });
    remember(this.#trees, key, MAX_CACHED_TREES, loading);
    return loading;
  }
}

/** What `listDirectory` would answer, from the tree of a commit whose index is not ready. */
function directoryOfTree(tree: RepoTree, directory: string, limit: number): DirectoryListing[] {
  const prefix = directory.length === 0 ? "" : `${directory}/`;
  const children = new Map<string, DirectoryListing>();
  for (const entry of tree.entries) {
    if (entry.type !== "file" || !entry.path.startsWith(prefix)) {
      continue;
    }
    const rest = entry.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    if (name.length > 0 && !children.has(name)) {
      children.set(name, {
        path: `${prefix}${name}`,
        kind: slash < 0 ? "file" : "directory",
        size: slash < 0 ? entry.size : null,
      });
    }
  }
  return [...children.values()]
    .sort(
      (a, b) => Number(a.kind === "file") - Number(b.kind === "file") || (a.path < b.path ? -1 : 1),
    )
    .slice(0, limit);
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
