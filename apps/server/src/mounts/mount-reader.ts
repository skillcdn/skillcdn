import {
  type BlobStore,
  FIND_DEFAULT_LIMIT,
  type FileResult,
  type FindItem,
  type FindResult,
  type GitHost,
  type IndexLimits,
  joinRepoPath,
  type MountSummary,
  pageOfText,
  parseRepoPath,
  READ_FILE_DEFAULT_LIMIT,
  type RepoPath,
  type RepoTree,
  relativeRepoPath,
  type SkillResult,
  splitFrontMatter,
} from "@skillcdn/core";
import {
  countEntries,
  type Database,
  type EntryRecord,
  findSkills,
  getEntry,
  getSnapshotDiagnostics,
  listEntries,
  listSkillFiles,
  type SnapshotDiagnostic,
  type SnapshotRecord,
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
  | { readonly kind: "not_found"; readonly available: readonly string[] }
  | { readonly kind: "ambiguous"; readonly directories: readonly string[] }
  /** Indexed, but its body is not in the blob store. */
  | { readonly kind: "unavailable" };

export type FileLookup =
  | { readonly kind: "found"; readonly file: FileResult }
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
}

export interface MountOverview {
  readonly mount: MountSummary;
  readonly skillCount: number;
  readonly documentCount: number;
  readonly skills: readonly SkillListing[];
  readonly documents: readonly Extract<FindItem, { kind: "document" }>[];
  readonly diagnostics: readonly SnapshotDiagnostic[];
}

const MAX_LISTED_SKILL_FILES = 50;
const MAX_SUGGESTED_SKILLS = 20;
const MAX_CACHED_TREES = 8;

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

  constructor(dependencies: MountReaderDependencies) {
    this.#dependencies = dependencies;
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
      // Verification arrives with the GitHub App. Until then every repository is unverified.
      verified: false,
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
    const rows =
      query === undefined
        ? await listEntries(database, scope, mount.address.path, limit)
        : await searchEntries(database, scope, mount.address.path, query, limit);
    return {
      status: "ready",
      result: {
        mount: this.summary(mount, outcome.snapshot),
        query,
        items: rows.map((row) => toFindItem(mount, row)).filter((item) => item !== undefined),
      },
    };
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
      const available = (
        await listEntries(database, scope, mount.address.path, MAX_SUGGESTED_SKILLS, "skills")
      ).flatMap((row) => (row.name === null ? [] : [row.name]));
      return { status: "ready", lookup: { kind: "not_found", available } };
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
    const files = await listSkillFiles(
      database,
      scope,
      skill.skillDir ?? "",
      MAX_LISTED_SKILL_FILES + 1,
    );
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
          warnings: skill.frontMatter?.warnings ?? [],
        },
      },
    };
  }

  /** Reads a page of a text file. Never waits for the index: the commit's tree answers meanwhile. */
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
    const relative = parseRepoPath(input.path);
    if (!relative.ok || relative.value.length === 0) {
      return {
        kind: "invalid_path",
        reason: relative.ok ? "the path is empty" : relative.error.message,
      };
    }
    const path = joinRepoPath(mount.address.path, relative.value);

    const outcome = await snapshots.ready(mount, 0);
    let file: { readonly size: number; readonly hash: string } | undefined;
    if (outcome.status === "ready") {
      const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
      const entry = await getEntry(database, scope, path);
      file = entry === undefined ? undefined : { size: entry.size, hash: entry.blobSha };
    } else {
      const tree = await this.#treeOf(mount);
      const entry = tree.entries.find(
        (candidate) => candidate.type === "file" && candidate.path === path,
      );
      file = entry === undefined ? undefined : { size: entry.size, hash: entry.hash };
    }
    if (file === undefined) {
      return { kind: "not_found", path: relative.value };
    }
    if (file.size > limits.maxReadableFileBytes) {
      return {
        kind: "too_large",
        path: relative.value,
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
        return { kind: "not_text", path: relative.value };
      }
      await blobStore.write(file.hash, text);
    }
    return {
      kind: "found",
      file: {
        mount: this.summary(mount, outcome.status === "ready" ? outcome.snapshot : undefined),
        path: relative.value,
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
    const [counts, skills, documents, diagnostics] = await Promise.all([
      countEntries(database, scope, path),
      listEntries(database, scope, path, listLimit, "skills"),
      listEntries(database, scope, path, listLimit, "documents"),
      getSnapshotDiagnostics(database, scope),
    ]);
    return {
      status: "ready",
      overview: {
        mount: this.summary(mount, outcome.snapshot),
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
    const loading = this.#dependencies.gitHost.getTree(mount.coordinates, mount.commit);
    loading.catch(() => {
      this.#trees.delete(key);
    });
    this.#trees.set(key, loading);
    if (this.#trees.size > MAX_CACHED_TREES) {
      const oldest = this.#trees.keys().next().value;
      if (oldest !== undefined) {
        this.#trees.delete(oldest);
      }
    }
    return loading;
  }
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
      : { kind: "skill", name: row.name, directory, description: row.description ?? "" };
  }
  const path = belowMount(mount, row.path);
  return path === undefined
    ? undefined
    : {
        kind: "document",
        path,
        title: row.title ?? undefined,
        summary: row.description ?? undefined,
      };
}
