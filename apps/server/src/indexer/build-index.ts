import {
  type BlobStore,
  baseName,
  classifyRepoFile,
  type GitHost,
  GitHostError,
  type IndexLimits,
  inspectMarkdownReferences,
  isServedPath,
  joinRepoPath,
  nearestDirectoryAtOrAbove,
  owningSkillDirectory,
  parentDirectory,
  parseRepoManifest,
  parseSkillManifest,
  type RepoCoordinates,
  type RepoFileKind,
  type RepoPath,
  type ServedScope,
  splitFrontMatter,
  summarizeMarkdown,
  type TreeEntry,
} from "@skillcdn/core";
import type {
  NewIndexEntry,
  SnapshotDiagnostic,
  SnapshotIndex,
  StoredTranslation,
} from "@skillcdn/db";
import { gitBlobHash } from "./git-hash.js";
import { decodeText } from "./text.js";

/**
 * The version of the reading rules: what is served, what is searched, how a document is
 * summarized. Bump it when a change would make the index of a commit come out differently. The
 * snapshot row keeps the version it was written with, and a commit indexed under an older one
 * is rebuilt when it is next asked for (`ensureSnapshot` in @skillcdn/db); without the bump, a
 * deployment keeps serving what the old rules produced until the repository moves on.
 */
export const INDEX_VERSION = 4;

const MAX_DIAGNOSTICS = 50;
const FETCH_CONCURRENCY = 8;
/** With this many bodies to fetch, one archive request is cheaper than one request per file. */
const ARCHIVE_THRESHOLD = 4;
/** Follow local Markdown references this many edges beyond an already served file. */
const MAX_REFERENCE_DEPTH = 8;

export interface BuildIndexOptions {
  /** Only the reading side of the port: a tree, and bodies by hash. */
  readonly gitHost: Pick<GitHost, "getTree" | "readBlob" | "readArchive">;
  readonly blobStore: BlobStore;
  readonly coordinates: RepoCoordinates;
  readonly commit: string;
  readonly limits: IndexLimits;
  readonly signal: AbortSignal;
}

interface Candidate {
  readonly entry: TreeEntry;
  readonly kind: RepoFileKind;
}

/** The kinds whose bodies are fetched and searched. */
const DOCUMENT_KINDS: readonly RepoFileKind[] = ["markdown", "json"];

const byPath = (a: Candidate, b: Candidate): number => (a.entry.path < b.entry.path ? -1 : 1);

/** Raw front-matter can contain translations meant only for the human-facing page. */
function summarizeSearchableMarkdown(text: string) {
  const split = splitFrontMatter(text);
  return summarizeMarkdown(split.kind === "unterminated" ? "" : text);
}

/** Translations as the index stores them: only the fields that are there. */
function storedTranslations(
  translations: Readonly<
    Record<
      string,
      {
        readonly title?: string | undefined;
        readonly name?: string | undefined;
        readonly description?: string | undefined;
      }
    >
  >,
): Readonly<Record<string, StoredTranslation>> | undefined {
  const stored: Record<string, StoredTranslation> = {};
  for (const [tag, entry] of Object.entries(translations)) {
    stored[tag] = {
      ...(entry.title === undefined ? {} : { title: entry.title }),
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.description === undefined ? {} : { description: entry.description }),
    };
  }
  return Object.keys(stored).length === 0 ? undefined : stored;
}

/** Runs `work` over `items` with a bounded number in flight. Stops at the first failure. */
async function forEachConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) {
        await work(item);
      }
    }
  });
  await Promise.all(runners);
}

/**
 * Reads one commit into an index: lists the tree, fetches the bodies of the files that are
 * searched, and parses them with the convention parser. Repository content is data throughout:
 * nothing is executed, symlinks and submodules are not followed, and every limit turns "too
 * much" into a partial index that says so, never into a failure.
 *
 * The bodies come in two rounds. The manifests (SKILLCDN.md) and the skills (SKILL.md) first,
 * because they decide which other files are served at all, and because when a repository is
 * over the limits they are what must survive; then the documents that are served.
 */
export async function buildSnapshotIndex(options: BuildIndexOptions): Promise<SnapshotIndex> {
  const { gitHost, blobStore, coordinates, commit, limits, signal } = options;
  const tree = await gitHost.getTree(coordinates, commit);
  signal.throwIfAborted();

  let truncated = tree.truncated;
  // Declarations survive tree admission before support files. Their presence is a boundary even
  // if their bodies exceed a later limit. An exact SKILL.md also declares a hidden skill root.
  const declarationRank = (path: RepoPath): number => {
    const kind = classifyRepoFile(path);
    return kind === "manifest" ? 0 : kind === "skill" ? 1 : 2;
  };
  const files = tree.entries
    .filter((entry) => entry.type === "file")
    .sort(
      (a, b) => declarationRank(a.path) - declarationRank(b.path) || (a.path < b.path ? -1 : 1),
    );
  if (files.length > limits.maxTreeEntries) {
    files.length = limits.maxTreeEntries;
    truncated = true;
  }
  const candidates: Candidate[] = files.map((entry) => ({
    entry,
    kind: classifyRepoFile(entry.path),
  }));

  // What the index holds, admitted in the order of the rounds and within the limits.
  const admitted = new Map<RepoPath, Candidate>();
  let indexedBytes = 0;
  const admit = (candidate: Candidate): boolean => {
    if (admitted.has(candidate.entry.path)) return true;
    const { size } = candidate.entry;
    if (size > limits.maxIndexedFileBytes) {
      truncated = true;
      return false;
    }
    if (
      admitted.size >= limits.maxIndexedFiles ||
      indexedBytes + size > limits.maxIndexedTotalBytes
    ) {
      truncated = true;
      return false;
    }
    admitted.set(candidate.entry.path, candidate);
    indexedBytes += size;
    return true;
  };

  // Bodies are content-addressed: whatever an earlier commit or another repository already
  // stored is not fetched again.
  const texts = new Map<string, string | undefined>();
  const fetchBodies = async (wanted: readonly Candidate[]): Promise<void> => {
    const missing = await blobStore.missing(wanted.map(({ entry }) => entry.hash));

    // The archive is a transport, not a source of truth: it may convert line endings, expand
    // keywords or leave files out. A body counts only when it hashes to what the tree says;
    // everything else falls through to the per-file path below.
    if (gitHost.readArchive !== undefined && missing.size >= ARCHIVE_THRESHOLD) {
      const awaited = new Map(
        wanted
          .filter(({ entry }) => missing.has(entry.hash))
          .map(({ entry }) => [entry.path, entry]),
      );
      try {
        const archive = gitHost.readArchive(coordinates, commit, {
          wants: (path, size) => awaited.has(path) && size <= limits.maxIndexedFileBytes,
          maxArchiveBytes: limits.maxArchiveBytes,
        });
        for await (const file of archive) {
          signal.throwIfAborted();
          const entry = awaited.get(file.path);
          if (entry === undefined || gitBlobHash(file.bytes) !== entry.hash) {
            continue;
          }
          const text = decodeText(file.bytes);
          if (text !== undefined) {
            await blobStore.write(entry.hash, text);
          }
          texts.set(entry.hash, text);
        }
      } catch (error) {
        // Without the archive the work is the same, only slower. A rate limit is different:
        // asking again file by file would make it worse.
        const recoverable = error instanceof GitHostError && error.kind !== "rate_limited";
        if (signal.aborted || !recoverable) {
          throw error;
        }
      }
    }

    await forEachConcurrently(wanted, FETCH_CONCURRENCY, async ({ entry }) => {
      signal.throwIfAborted();
      if (texts.has(entry.hash)) {
        return;
      }
      if (!missing.has(entry.hash)) {
        texts.set(entry.hash, await blobStore.read(entry.hash));
        return;
      }
      // Reserve the hash so that a second file with the same content does not fetch it again.
      texts.set(entry.hash, undefined);
      let bytes: Uint8Array;
      try {
        bytes = await gitHost.readBlob(coordinates, entry.hash, limits.maxIndexedFileBytes);
      } catch (error) {
        // One unreadable file does not fail the repository. Anything else does, and is retried.
        if (
          error instanceof GitHostError &&
          (error.kind === "invalid" || error.kind === "not_found")
        ) {
          return;
        }
        throw error;
      }
      const text = decodeText(bytes);
      if (text !== undefined) {
        await blobStore.write(entry.hash, text);
        texts.set(entry.hash, text);
      }
    });
    signal.throwIfAborted();
  };

  const diagnostics: SnapshotDiagnostic[] = [];
  const report = (path: RepoPath, code: string, message: string): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) {
      diagnostics.push({ path, code, message });
    }
  };
  const referencesOf = (path: RepoPath, text: string) => {
    const inspected = inspectMarkdownReferences(path, text);
    if (inspected.truncated) {
      truncated = true;
      report(
        path,
        "reference_limit",
        "Markdown reference extraction exceeded its input or reference limit; some links were not inspected",
      );
    }
    return inspected.references;
  };

  // Round one: what declares. Manifests before skills, so that a manifest survives the limits.
  const declaring = candidates
    .filter(({ kind }) => kind === "manifest" || kind === "skill")
    .sort((a, b) => Number(b.kind === "manifest") - Number(a.kind === "manifest") || byPath(a, b));
  await fetchBodies(declaring.filter(admit));

  const manifests = new Map<RepoPath, NewIndexEntry>();
  const skills = new Map<RepoPath, NewIndexEntry>();
  const documents = new Map<RepoPath, NewIndexEntry>();
  /** Skill manifests that could not be read as skills. */
  const unreadSkills = new Set<RepoPath>();
  /** Per manifest directory, the document directories it declares. A broken one declares none. */
  const documentDirectories = new Map<RepoPath, readonly RepoPath[]>();
  const brokenManifestDirectories = new Set<RepoPath>();

  for (const { entry, kind } of declaring) {
    const directory = parentDirectory(entry.path);
    const text = admitted.has(entry.path) ? texts.get(entry.hash) : undefined;
    const base = {
      path: entry.path,
      size: entry.size,
      blobSha: entry.hash,
      skillDir: undefined,
      visible: true,
    };
    if (kind === "manifest") {
      // A manifest that cannot be read still governs its directory: fail closed, and say why.
      documentDirectories.set(directory, []);
      const broken = (code: string, message: string): void => {
        brokenManifestDirectories.add(directory);
        report(entry.path, code, message);
        manifests.set(entry.path, {
          ...base,
          kind: "manifest",
          name: undefined,
          title: undefined,
          description: undefined,
          frontMatter: { metadata: {}, warnings: [], manifestError: code },
          searchable: false,
        });
      };
      if (text === undefined) {
        broken(
          admitted.has(entry.path) ? "unavailable" : "index_limit",
          admitted.has(entry.path)
            ? "the manifest could not be read"
            : "the manifest exceeds the indexing limits",
        );
        continue;
      }
      const parsed = parseRepoManifest(text);
      if (!parsed.ok) {
        broken(parsed.error.code, parsed.error.message);
        continue;
      }
      const { manifest, warnings } = parsed.value;
      documentDirectories.set(
        directory,
        manifest.documents.map((declared) => joinRepoPath(directory, declared)),
      );
      manifests.set(entry.path, {
        ...base,
        kind: "manifest",
        name: manifest.name,
        title: undefined,
        description: manifest.description,
        frontMatter: {
          ...(manifest.license === undefined ? {} : { license: manifest.license }),
          metadata: { ...manifest.metadata },
          warnings: warnings.map((warning) => warning.message),
          documents: [...manifest.documents],
          references: referencesOf(entry.path, text),
          ...(manifest.language === undefined ? {} : { language: manifest.language }),
          ...(storedTranslations(manifest.translations) === undefined
            ? {}
            : { translations: storedTranslations(manifest.translations) }),
        },
        searchable: false,
      });
      continue;
    }
    if (text === undefined) {
      report(
        entry.path,
        admitted.has(entry.path) ? "unavailable" : "index_limit",
        admitted.has(entry.path)
          ? "the skill manifest could not be read"
          : "the skill manifest exceeds the indexing limits",
      );
      continue;
    }
    const parsed = parseSkillManifest(text, {
      directoryName: directory.length === 0 ? undefined : baseName(directory),
    });
    if (parsed.ok) {
      const { manifest, warnings } = parsed.value;
      skills.set(directory, {
        ...base,
        kind: "skill",
        name: manifest.name,
        title: undefined,
        description: manifest.description,
        frontMatter: {
          ...(manifest.license === undefined ? {} : { license: manifest.license }),
          ...(manifest.compatibility === undefined
            ? {}
            : { compatibility: manifest.compatibility }),
          ...(manifest.allowedTools === undefined ? {} : { allowedTools: manifest.allowedTools }),
          metadata: { ...manifest.metadata },
          warnings: warnings.map((warning) => warning.message),
          references: referencesOf(entry.path, text),
          ...(manifest.include.length === 0 ? {} : { include: [...manifest.include] }),
          ...(storedTranslations(manifest.translations) === undefined
            ? {}
            : { translations: storedTranslations(manifest.translations) }),
        },
        searchable: true,
        searchBody: manifest.body,
      });
      continue;
    }
    report(entry.path, parsed.error.code, parsed.error.message);
    // A SKILL.md that cannot be read as a skill is a document: readable wherever it is, so that
    // the author can see what was found, and listed and searched only where a document would be.
    unreadSkills.add(entry.path);
    const summary = summarizeSearchableMarkdown(text);
    documents.set(entry.path, {
      ...base,
      kind: "markdown",
      name: undefined,
      title: summary.title,
      description: summary.description,
      frontMatter: undefined,
      searchable: true,
      searchBody: summary.body,
    });
  }

  const skillDirectories = new Set(skills.keys());
  const includedFiles = new Set<RepoPath>();
  for (const [directory, skill] of skills) {
    for (const include of skill.frontMatter?.include ?? []) {
      includedFiles.add(joinRepoPath(directory, include as RepoPath));
    }
  }
  const scope: ServedScope = {
    skillDirectories,
    manifestDirectories: new Set(documentDirectories.keys()),
    documentDirectories,
    includedFiles,
  };
  const linkedFiles = new Set<RepoPath>();
  const served = (path: RepoPath): boolean => isServedPath(path, scope) || linkedFiles.has(path);
  const permitsLinks = (path: RepoPath): boolean => {
    const governing = nearestDirectoryAtOrAbove(parentDirectory(path), scope.manifestDirectories);
    return governing === undefined || !brokenManifestDirectories.has(governing);
  };

  // Round two: the documents that are served. The others are known to the index and nothing else.
  const reading = candidates
    .filter(({ entry, kind }) => DOCUMENT_KINDS.includes(kind) && served(entry.path))
    .sort(byPath)
    .filter(admit);
  await fetchBodies(reading);

  const indexDocument = ({ entry, kind }: Candidate, linkedOnly: boolean): void => {
    const text = texts.get(entry.hash);
    if (text === undefined) {
      return;
    }
    const summary = kind === "json" ? undefined : summarizeSearchableMarkdown(text);
    documents.set(entry.path, {
      path: entry.path,
      size: entry.size,
      blobSha: entry.hash,
      skillDir: undefined,
      kind: kind === "json" ? "json" : "markdown",
      name: undefined,
      title: summary?.title,
      description: summary?.description,
      frontMatter: {
        metadata: {},
        warnings: [],
        ...(kind === "json" ? {} : { references: referencesOf(entry.path, text) }),
        ...(linkedOnly ? { linkedOnly: true } : {}),
      },
      searchable: !linkedOnly,
      ...(summary === undefined ? {} : { searchBody: summary.body }),
      visible: true,
    });
  };
  for (const candidate of reading) {
    indexDocument(candidate, false);
  }

  // Links extend readability, not the catalog. The graph is evaluated once per repository and
  // commit; mounts only restrict which of these canonical paths a caller may retrieve.
  const byCandidatePath = new Map(candidates.map((candidate) => [candidate.entry.path, candidate]));
  let frontier = [...skills.values(), ...manifests.values(), ...documents.values()];
  const visited = new Set<RepoPath>();
  for (let depth = 0; frontier.length > 0; depth += 1) {
    const next: Candidate[] = [];
    for (const source of frontier) {
      const sourcePath = source.path as RepoPath;
      if (visited.has(sourcePath) || !permitsLinks(sourcePath) || !served(sourcePath)) continue;
      visited.add(sourcePath);
      for (const reference of source.frontMatter?.references ?? []) {
        const path = reference.path as RepoPath;
        const candidate = byCandidatePath.get(path);
        if (candidate === undefined || served(path) || !permitsLinks(path)) continue;
        // A SKILL.md or SKILLCDN.md keeps its declaration identity; a link cannot turn a
        // failed declaration into an ordinary document or bypass its boundary.
        if (candidate.kind !== "markdown") continue;
        if (depth >= MAX_REFERENCE_DEPTH) {
          truncated = true;
          continue;
        }
        if (!admit(candidate)) continue;
        linkedFiles.add(path);
        next.push(candidate);
      }
    }
    await fetchBodies(next);
    for (const candidate of next) indexDocument(candidate, true);
    frontier = next.flatMap(({ entry }) => {
      const document = documents.get(entry.path);
      return document === undefined ? [] : [document];
    });
  }

  const entries: NewIndexEntry[] = files.map((entry) => {
    const skill = skills.get(parentDirectory(entry.path));
    const indexed =
      skill !== undefined && skill.path === entry.path
        ? skill
        : (manifests.get(entry.path) ?? documents.get(entry.path));
    const skillDir = owningSkillDirectory(entry.path, skillDirectories);
    const visible = served(entry.path);
    if (indexed !== undefined) {
      return unreadSkills.has(entry.path)
        ? { ...indexed, skillDir, visible: true, searchable: visible }
        : { ...indexed, skillDir, visible };
    }
    return {
      path: entry.path,
      kind: "other",
      size: entry.size,
      blobSha: entry.hash,
      skillDir,
      name: undefined,
      title: undefined,
      description: undefined,
      frontMatter: linkedFiles.has(entry.path)
        ? { metadata: {}, warnings: [], linkedOnly: true }
        : undefined,
      searchable: false,
      visible,
    };
  });

  return { entries, truncated, indexedBytes, diagnostics, version: INDEX_VERSION };
}
