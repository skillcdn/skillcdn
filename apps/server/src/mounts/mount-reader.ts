import {
  type BlobStore,
  type CatalogState,
  classifyRepoFile,
  type DirectoryResult,
  FIND_DEFAULT_LIMIT,
  FIND_LIST_SKILLS_MAX,
  FIND_MAX_SKILL_FILES,
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
  joinRepoPath,
  MAX_SKILL_INCLUDED_LENGTH,
  MAX_SKILL_RULES_LENGTH,
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
  relativeRepoPath,
  type ServedScope,
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
} from "@skillcdn/db";
import type { SnapshotOutcome, SnapshotService } from "../indexer/snapshot-service.js";
import { decodeText } from "../indexer/text.js";
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
  | { readonly kind: "not_found"; readonly path: RepoPath }
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
/**
 * A search fetches more rows than it answers with, because a skill's files fold into the skill:
 * several rows can become one item.
 */
const FIND_FETCH_FACTOR = 4;
const FIND_FETCH_MAX = 100;

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
      return {
        path: belowMount(mount, row.path),
        name: row.name ?? undefined,
        description: row.description,
        language: row.frontMatter?.language,
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
      ]).then(([skills, counts, manifest, diagnostics]) => ({
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
    input: { readonly query?: string | undefined; readonly limit?: number | undefined },
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
    const path = mount.address.path;
    let items: FindItem[];
    let totals: FindResult["totals"];
    if (query === undefined) {
      // A listing names every skill: a skill's own files are reached through the skill.
      const [skills, documents, counts] = await Promise.all([
        listEntries(database, scope, path, FIND_LIST_SKILLS_MAX, "skills"),
        listEntries(database, scope, path, limit, "documents_outside_skills"),
        countEntries(database, scope, path),
      ]);
      items = [...skills, ...documents]
        .map((row) => toFindItem(mount, row))
        .filter((item) => item !== undefined);
      totals = counts;
    } else {
      const rows = await searchEntries(
        database,
        scope,
        path,
        query,
        Math.min(limit * FIND_FETCH_FACTOR, FIND_FETCH_MAX),
      );
      items = (await this.#fold(mount, scope, rows)).slice(0, limit);
      totals = undefined;
    }
    return {
      status: "ready",
      result: {
        mount: this.summary(mount, outcome.snapshot),
        query,
        items,
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
  ): Promise<NotReady | { readonly status: "ready"; readonly lookup: SkillLookup }> {
    const { database, blobStore, snapshots } = this.#dependencies;
    const outcome = await snapshots.ready(mount, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
    const name = wanted.trim();
    const asDirectory = parseRepoPath(name);
    const directory = asDirectory.ok
      ? joinRepoPath(mount.address.path, asDirectory.value)
      : undefined;
    const found = await findSkills(database, scope, mount.address.path, { name, directory }, 10);
    const exact = found.filter((row) => row.name === name || row.skillDir === directory);
    const matches = exact.length > 0 ? exact : found;

    if (matches.length === 0) {
      const [listed, diagnostics] = await Promise.all([
        listEntries(database, scope, mount.address.path, MAX_SUGGESTED_SKILLS, "skills"),
        this.#diagnosticsOf(mount, scope),
      ]);
      const available = listed.flatMap((row) => (row.name === null ? [] : [row.name]));
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
    const [files, manifest, included] = await Promise.all([
      listSkillFiles(database, scope, skill.skillDir ?? "", MAX_LISTED_SKILL_FILES + 1),
      this.#manifestOf(mount, scope),
      this.#includedFiles(mount, scope, skill.skillDir ?? "", skill.frontMatter?.include ?? []),
    ]);
    let rules: SkillRules | undefined;
    if (manifest !== undefined && manifest.rules.length > 0) {
      const truncated = manifest.rules.length > MAX_SKILL_RULES_LENGTH;
      rules = {
        path: manifest.path,
        body: truncated ? manifest.rules.slice(0, MAX_SKILL_RULES_LENGTH) : manifest.rules,
        truncated,
      };
    }
    return {
      status: "ready",
      lookup: {
        kind: "found",
        skill: {
          mount: this.summary(mount, outcome.snapshot),
          name: skill.name,
          directory: skillDirectory,
          description: skill.description ?? "",
          license: skill.frontMatter?.license,
          compatibility: skill.frontMatter?.compatibility,
          allowedTools: skill.frontMatter?.allowedTools,
          metadata: skill.frontMatter?.metadata ?? {},
          body: split.kind === "found" ? split.body : text,
          files: files
            .slice(0, MAX_LISTED_SKILL_FILES)
            .map((file) => belowMount(mount, file))
            .filter((file) => file !== undefined),
          filesTruncated: files.length > MAX_LISTED_SKILL_FILES,
          included,
          warnings: skill.frontMatter?.warnings ?? [],
          rules,
          translations: skillTranslationsOf(skill.frontMatter?.translations),
        },
      },
    };
  }

  /**
   * The files a skill declares as needed on every run, with their text, in the order declared
   * and within one budget for all of them: past it a file is cut, and `read_file` has the rest.
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
        const text = entry === undefined ? undefined : await blobStore.read(entry.blobSha);
        return { path, text };
      }),
    );
    let remaining = MAX_SKILL_INCLUDED_LENGTH;
    const included: IncludedFile[] = [];
    for (const file of read) {
      if (file === undefined) {
        continue;
      }
      if (file.text === undefined) {
        included.push({ path: file.path, content: undefined, truncated: false });
        continue;
      }
      const content = remaining <= 0 ? "" : pageOfText(file.text, 0, remaining).content;
      remaining -= content.length;
      included.push({ path: file.path, content, truncated: content.length < file.text.length });
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
    const wanted = input.path.trim();
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
    const path = joinRepoPath(mount.address.path, below);

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
        return { kind: "not_found", path: below };
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
    return {
      kind: "found",
      file: {
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
    const [counts, skills, documents, diagnostics, manifest] = await Promise.all([
      countEntries(database, scope, path),
      listEntries(database, scope, path, listLimit, "skills"),
      listEntries(database, scope, path, listLimit, "documents_outside_skills"),
      this.#diagnosticsOf(mount, scope),
      this.#manifestOf(mount, scope),
    ]);
    return {
      status: "ready",
      overview: {
        mount: this.summary(mount, outcome.snapshot),
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
    // Hidden entries are never served, from the tree any more than from the index. Nor is what a
    // manifest leaves out: until the commit is indexed nothing has read the manifests, so under
    // one only the skills and the manifests themselves are served, which fails closed. Where no
    // manifest governs, the default directories are served, as always.
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
          skillDirectories: directoriesOf("skill"),
          manifestDirectories: directoriesOf("manifest"),
          documentDirectories: new Map(),
        };
        return { ...tree, entries: files.filter((entry) => isServedPath(entry.path, scope)) };
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
  return parsed?.ok === true ? relativeRepoPath(mount.address.path, parsed.value) : undefined;
}

function toFindItem(mount: Mount, row: EntryRecord): FindItem | undefined {
  if (row.kind === "skill") {
    const directory = belowMount(mount, row.skillDir);
    return directory === undefined || row.name === null
      ? undefined
      : {
          kind: "skill",
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
