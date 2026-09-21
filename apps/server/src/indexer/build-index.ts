import {
  type BlobStore,
  baseName,
  classifyRepoFile,
  type GitHost,
  GitHostError,
  type IndexLimits,
  owningSkillDirectory,
  parentDirectory,
  parseSkillManifest,
  type RepoCoordinates,
  type RepoFileKind,
  type RepoPath,
  summarizeMarkdown,
  type TreeEntry,
} from "@skillcdn/core";
import type { NewIndexEntry, SnapshotDiagnostic, SnapshotIndex } from "@skillcdn/db";
import { decodeText } from "./text.js";

const MAX_DIAGNOSTICS = 50;
const FETCH_CONCURRENCY = 8;

export interface BuildIndexOptions {
  readonly gitHost: GitHost;
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

const SEARCHABLE_KINDS: readonly RepoFileKind[] = ["skill", "markdown", "json"];

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
 * Reads one commit into an index: lists the tree, fetches the bodies of searchable files that the
 * blob store does not have yet, and parses them with the convention parser. Repository content is
 * data throughout: nothing is executed, symlinks and submodules are not followed, and every limit
 * turns "too much" into a partial index that says so, never into a failure.
 */
export async function buildSnapshotIndex(options: BuildIndexOptions): Promise<SnapshotIndex> {
  const { gitHost, blobStore, coordinates, commit, limits, signal } = options;
  const tree = await gitHost.getTree(coordinates, commit);
  signal.throwIfAborted();

  let truncated = tree.truncated;
  const files = tree.entries.filter((entry) => entry.type === "file");
  if (files.length > limits.maxTreeEntries) {
    files.length = limits.maxTreeEntries;
    truncated = true;
  }

  // Skills first: when a repository is over the limits, its skills are what must survive.
  const candidates: Candidate[] = files
    .map((entry) => ({ entry, kind: classifyRepoFile(entry.path) }))
    .filter(({ kind }) => SEARCHABLE_KINDS.includes(kind))
    .sort(
      (a, b) =>
        Number(b.kind === "skill") - Number(a.kind === "skill") ||
        (a.entry.path < b.entry.path ? -1 : 1),
    );

  const searchable = new Map<RepoPath, Candidate>();
  let indexedBytes = 0;
  for (const candidate of candidates) {
    const { size } = candidate.entry;
    if (size > limits.maxIndexedFileBytes) {
      continue;
    }
    if (
      searchable.size >= limits.maxIndexedFiles ||
      indexedBytes + size > limits.maxIndexedTotalBytes
    ) {
      truncated = true;
      continue;
    }
    searchable.set(candidate.entry.path, candidate);
    indexedBytes += size;
  }

  // Bodies are content-addressed: whatever an earlier commit or another repository already
  // stored is not fetched again.
  const wanted = [...searchable.values()];
  const missing = await blobStore.missing(wanted.map(({ entry }) => entry.hash));
  const texts = new Map<string, string | undefined>();
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

  const diagnostics: SnapshotDiagnostic[] = [];
  const skills = new Map<RepoPath, NewIndexEntry>();
  const documents = new Map<RepoPath, NewIndexEntry>();

  for (const { entry, kind } of wanted) {
    const text = texts.get(entry.hash);
    if (text === undefined) {
      continue;
    }
    const base = {
      path: entry.path,
      size: entry.size,
      blobSha: entry.hash,
      skillDir: undefined,
      searchable: true,
    };
    if (kind === "skill") {
      const directory = parentDirectory(entry.path);
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
          },
        });
        continue;
      }
      if (diagnostics.length < MAX_DIAGNOSTICS) {
        diagnostics.push({
          path: entry.path,
          code: parsed.error.code,
          message: parsed.error.message,
        });
      }
      // A manifest that does not parse is still a readable, searchable document.
    }
    const summary = kind === "json" ? undefined : summarizeMarkdown(text);
    documents.set(entry.path, {
      ...base,
      kind: kind === "json" ? "json" : "markdown",
      name: undefined,
      title: summary?.title,
      description: summary?.description,
      frontMatter: undefined,
    });
  }

  const skillDirectories = new Set(skills.keys());
  const entries: NewIndexEntry[] = files.map((entry) => {
    const skill = skills.get(parentDirectory(entry.path));
    const indexed =
      skill !== undefined && skill.path === entry.path ? skill : documents.get(entry.path);
    const skillDir = owningSkillDirectory(entry.path, skillDirectories);
    if (indexed !== undefined) {
      return { ...indexed, skillDir };
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
      frontMatter: undefined,
      searchable: false,
    };
  });

  return { entries, truncated, indexedBytes, diagnostics };
}
