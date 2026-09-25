import {
  assembleSkillDocument,
  type BlobStore,
  baseName,
  classifyLicenseFile,
  classifyRepoFile,
  DomainError,
  decodeText,
  describeListingProblem,
  type GitHost,
  GitHostError,
  type IndexLimits,
  inspectMarkdownReferences,
  isExcludedPath,
  isHiddenSkill,
  isReadmePath,
  isServedPath,
  isWithinRepoPath,
  joinRepoPath,
  type LicenseFact,
  MAX_LICENSE_TEXT_LENGTH,
  owningSkillDirectory,
  parentDirectory,
  parseRepoManifest,
  parseSkillManifest,
  preferredLicenseFile,
  type RepoCoordinates,
  type RepoFileKind,
  type RepoPath,
  ROOT_PATH,
  relativeRepoPath,
  resolveLicense,
  type ServedScope,
  type SkillListingProblem,
  selectReadmePaths,
  skillDocumentInput,
  skillListingProblem,
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
import { gitBlobHash, sha256Hex } from "./git-hash.js";

/**
 * The version of the reading rules: what is served, what is searched, how a document is
 * summarized. Bump it when a change would make the index of a commit come out differently. The
 * snapshot row keeps the version it was written with, and a commit indexed under an older one
 * is rebuilt when it is next asked for (`ensureSnapshot` in @skillcdn/db); without the bump, a
 * deployment keeps serving what the old rules produced until the repository moves on.
 */
export const INDEX_VERSION = 7;

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
 * The bodies come in three rounds. The manifests (SKILLCDN.md) and the skills (SKILL.md) first,
 * because they decide which other files are served at all, and because when a repository is
 * over the limits they are what must survive; then the documents that are served; then every
 * other file of the skills the skills extension may list, so that each has a digest.
 */
export async function buildSnapshotIndex(options: BuildIndexOptions): Promise<SnapshotIndex> {
  const { gitHost, blobStore, coordinates, commit, limits, signal } = options;
  const tree = await gitHost.getTree(coordinates, commit);
  signal.throwIfAborted();
  // A listing that may be missing a manifest cannot be published: a manifest that was never seen
  // would not withhold what it governs, and the defaults would publish in its place.
  if (tree.truncated) {
    throw new DomainError("indexer.tree_truncated", "the tree listing is incomplete");
  }

  let truncated = false;
  // Declarations survive tree admission before support files. Their presence is a boundary even
  // if their bodies exceed a later limit. An exact SKILL.md also declares a hidden skill root.
  const declarationRank = (path: RepoPath): number => {
    const kind = classifyRepoFile(path);
    return kind === "manifest" ? 0 : kind === "skill" ? 1 : 2;
  };
  const depth = (path: RepoPath): number => path.split("/").length;
  const files = tree.entries
    .filter((entry) => entry.type === "file" || classifyRepoFile(entry.path) === "manifest")
    .sort(
      (a, b) =>
        declarationRank(a.path) - declarationRank(b.path) ||
        (classifyRepoFile(a.path) === "manifest" ? depth(a.path) - depth(b.path) : 0) ||
        (a.path < b.path ? -1 : 1),
    );
  if (files.length > limits.maxTreeEntries) {
    // Manifests sort first, so the first entry over the limit says whether one would be lost.
    const first = files[limits.maxTreeEntries];
    if (first !== undefined && classifyRepoFile(first.path) === "manifest") {
      throw new DomainError(
        "indexer.tree_truncated",
        "the tree holds more manifests than the tree limit admits",
      );
    }
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
  const admit = (candidate: Candidate, maxFileBytes = limits.maxIndexedFileBytes): boolean => {
    if (admitted.has(candidate.entry.path)) return true;
    const { size } = candidate.entry;
    if (size > maxFileBytes) {
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
  // stored is not fetched again. Every body that is at hand has a digest, which is what the
  // skills extension declares for it (ADR-0025).
  const texts = new Map<string, string | undefined>();
  const digests = new Map<string, { readonly digest: string; readonly size: number }>();
  const remember = (hash: string, bytes: Uint8Array): void => {
    texts.set(hash, decodeText(bytes));
    digests.set(hash, { digest: sha256Hex(bytes), size: bytes.byteLength });
  };
  const fetchBodies = async (wanted: readonly Candidate[], maxFileBytes: number): Promise<void> => {
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
          wants: (path, size) => awaited.has(path) && size <= maxFileBytes,
          maxArchiveBytes: limits.maxArchiveBytes,
        });
        for await (const file of archive) {
          signal.throwIfAborted();
          const entry = awaited.get(file.path);
          if (entry === undefined || gitBlobHash(file.bytes) !== entry.hash) {
            continue;
          }
          await blobStore.write(entry.hash, file.bytes);
          remember(entry.hash, file.bytes);
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
      // Reserve the hash so that a second file with the same content does not fetch it again.
      texts.set(entry.hash, undefined);
      if (!missing.has(entry.hash)) {
        const stored = await blobStore.readBytes(entry.hash);
        if (stored !== undefined) remember(entry.hash, stored);
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = await gitHost.readBlob(coordinates, entry.hash, maxFileBytes);
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
      await blobStore.write(entry.hash, bytes);
      remember(entry.hash, bytes);
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

  // Resolve policies from ancestors downward before fetching their descendants. A rejected
  // scope cannot spend the remaining budget or produce diagnostics for its private fixtures.
  const declaring = candidates
    .filter(({ kind }) => kind === "manifest" || kind === "skill")
    .sort(
      (a, b) =>
        Number(b.kind === "manifest") - Number(a.kind === "manifest") ||
        (a.kind === "manifest" ? depth(a.entry.path) - depth(b.entry.path) : 0) ||
        byPath(a, b),
    );

  const manifests = new Map<RepoPath, NewIndexEntry>();
  const skills = new Map<RepoPath, NewIndexEntry>();
  const documents = new Map<RepoPath, NewIndexEntry>();
  /** Skill manifests that could not be read as skills. */
  const unreadSkills = new Set<RepoPath>();
  /** Per manifest directory, the document directories it declares. A broken one declares none. */
  const documentDirectories = new Map<RepoPath, readonly RepoPath[]>();
  const brokenManifestDirectories = new Set<RepoPath>();
  const excludedPaths = new Set<RepoPath>();
  const policy = { excludedPaths, brokenManifestDirectories };
  const rounds: Candidate[][] = [];
  for (const candidate of declaring) {
    const previous = rounds.at(-1);
    const first = previous?.[0];
    if (
      first === undefined ||
      candidate.kind !== first.kind ||
      (candidate.kind === "manifest" && depth(candidate.entry.path) !== depth(first.entry.path))
    ) {
      rounds.push([candidate]);
    } else {
      previous?.push(candidate);
    }
  }

  // A policy cannot be taken away from the files it governs: an excluded manifest withholds its
  // whole directory. Excluding the directory says the same thing on purpose; excluding the
  // manifest alone is reported, as the author probably meant something else.
  const withholdExcludedManifest = (path: RepoPath): void => {
    const directory = parentDirectory(path);
    if (isExcludedPath(directory, policy)) return;
    excludedPaths.add(directory);
    report(
      path,
      "excluded_policy",
      "the manifest is excluded while its directory is not; a policy cannot be removed from what it governs, so the whole directory is withheld",
    );
  };

  for (const round of rounds) {
    for (const { entry, kind } of round) {
      if (kind === "manifest" && isExcludedPath(entry.path, policy)) {
        withholdExcludedManifest(entry.path);
      }
    }
    const permitted = round.filter(({ entry }) => !isExcludedPath(entry.path, policy));
    await fetchBodies(
      permitted
        .filter(({ entry }) => entry.type === "file")
        .filter((candidate) => admit(candidate)),
      limits.maxIndexedFileBytes,
    );
    for (const { entry, kind } of permitted) {
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
        if (entry.type !== "file") {
          broken(
            "unsupported_type",
            "the manifest must be a regular file; symlinks and submodules are not followed",
          );
          continue;
        }
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
        for (const excluded of manifest.exclude) {
          excludedPaths.add(joinRepoPath(directory, excluded));
        }
        documentDirectories.set(
          directory,
          manifest.documents.map((declared) => joinRepoPath(directory, declared)),
        );
        if (isExcludedPath(entry.path, policy)) {
          withholdExcludedManifest(entry.path);
          continue;
        }
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
            exclude: [...manifest.exclude],
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
    ...policy,
  };
  const linkedFiles = new Set<RepoPath>();
  const overviewDirectories = new Set<RepoPath>([ROOT_PATH]);
  for (const { entry } of candidates) {
    if (isReadmePath(entry.path) || !isServedPath(entry.path, scope)) continue;
    let directory = parentDirectory(entry.path);
    while (!overviewDirectories.has(directory)) {
      overviewDirectories.add(directory);
      directory = parentDirectory(directory);
    }
  }
  const overviewFiles = selectReadmePaths(
    candidates
      .filter(({ entry }) => !isExcludedPath(entry.path, scope))
      .map(({ entry }) => entry.path),
    overviewDirectories,
  );
  const served = (path: RepoPath): boolean =>
    !isExcludedPath(path, scope) &&
    (isServedPath(path, scope) || linkedFiles.has(path) || overviewFiles.has(path));

  // Round two: the documents that are served. The others are known to the index and nothing else.
  const reading = candidates
    .filter(({ entry, kind }) => DOCUMENT_KINDS.includes(kind) && served(entry.path))
    .sort(byPath)
    .filter((candidate) => admit(candidate));
  await fetchBodies(reading, limits.maxIndexedFileBytes);

  const indexDocument = ({ entry, kind }: Candidate, linkedOnly: boolean): void => {
    const text = texts.get(entry.hash);
    if (text === undefined) {
      return;
    }
    const summary = kind === "json" ? undefined : summarizeSearchableMarkdown(text);
    const overviewOnly = overviewFiles.has(entry.path) && !isServedPath(entry.path, scope);
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
        ...(overviewOnly ? { overviewOnly: true } : {}),
      },
      searchable: !linkedOnly && !overviewOnly,
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
      if (visited.has(sourcePath) || !served(sourcePath)) continue;
      visited.add(sourcePath);
      for (const reference of source.frontMatter?.references ?? []) {
        const path = reference.path as RepoPath;
        const candidate = byCandidatePath.get(path);
        if (candidate === undefined || served(path) || isExcludedPath(path, scope)) continue;
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
    await fetchBodies(next, limits.maxIndexedFileBytes);
    for (const candidate of next) indexDocument(candidate, true);
    frontier = next.flatMap(({ entry }) => {
      const document = documents.get(entry.path);
      return document === undefined ? [] : [document];
    });
  }

  // The licenses (ADR-0026): the repository's own file, and the file a skill's directory holds.
  // A license file is read to be classified; what it says decides how its skills are served.
  const licenseFiles = new Map<RepoPath, Candidate>();
  for (const directory of [ROOT_PATH, ...skillDirectories]) {
    const chosen = preferredLicenseFile(
      candidates
        .filter(({ entry }) => parentDirectory(entry.path) === directory)
        .map(({ entry }) => entry.path),
    );
    const candidate = chosen === undefined ? undefined : byCandidatePath.get(chosen);
    if (candidate !== undefined) licenseFiles.set(directory, candidate);
  }
  await fetchBodies(
    [...licenseFiles.values()].filter(
      (candidate) =>
        !texts.has(candidate.entry.hash) &&
        candidate.entry.size <= MAX_LICENSE_TEXT_LENGTH &&
        admit(candidate, MAX_LICENSE_TEXT_LENGTH),
    ),
    MAX_LICENSE_TEXT_LENGTH,
  );
  const licenseFacts = new Map<RepoPath, LicenseFact>();
  for (const [directory, { entry }] of licenseFiles) {
    licenseFacts.set(directory, classifyLicenseFile(entry.path, texts.get(entry.hash)));
  }
  /** The `license` fields of the manifests above a directory, nearest first. */
  const manifestFieldsAbove = (directory: RepoPath) =>
    [...manifests.values()]
      .filter(
        (manifest) =>
          manifest.frontMatter?.license !== undefined &&
          isWithinRepoPath(parentDirectory(manifest.path as RepoPath), directory),
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map((manifest) => ({
        path: manifest.path as RepoPath,
        value: manifest.frontMatter?.license ?? "",
      }));
  const licenseOf = (directory: RepoPath, skill: NewIndexEntry): LicenseFact =>
    resolveLicense({
      skillFile: licenseFacts.get(directory),
      skillField:
        skill.frontMatter?.license === undefined
          ? undefined
          : { path: skill.path as RepoPath, value: skill.frontMatter.license },
      manifestFields: manifestFieldsAbove(directory),
      rootFile: licenseFacts.get(ROOT_PATH),
    });
  const repositoryLicense = resolveLicense({
    manifestFields: manifestFieldsAbove(ROOT_PATH),
    rootFile: licenseFacts.get(ROOT_PATH),
  });

  // Round three: every served file of a skill the skills extension may list, whatever its kind,
  // so that each has a digest, then the document each such skill is served as (ADR-0025). A
  // skill a host cannot hold as a whole stays with the tools, and its entry says why.
  interface Listing {
    readonly directory: RepoPath;
    readonly skill: NewIndexEntry;
    /** Every served file inside the directory, the files of nested skills included. */
    readonly files: readonly Candidate[];
    problem: SkillListingProblem | undefined;
    detail: string | undefined;
    document: { readonly digest: string; readonly size: number } | undefined;
  }
  const listings: Listing[] = [];
  for (const [directory, skill] of skills) {
    const owned = candidates.filter(
      ({ entry }) => isWithinRepoPath(directory, entry.path) && served(entry.path),
    );
    const problem = skillListingProblem({
      directory,
      name: skill.name ?? "",
      files: owned.map(({ entry }) => ({
        size: entry.size,
        available: entry.size <= limits.maxReadableFileBytes,
      })),
    });
    listings.push({
      directory,
      skill,
      files: owned,
      problem,
      detail:
        problem === "file_unavailable"
          ? owned.find(({ entry }) => entry.size > limits.maxReadableFileBytes)?.entry.path
          : undefined,
      document: undefined,
    });
  }
  await fetchBodies(
    listings
      .filter((listing) => listing.problem === undefined)
      .flatMap((listing) => listing.files)
      .filter((candidate) => !texts.has(candidate.entry.hash))
      .filter((candidate) => admit(candidate, limits.maxReadableFileBytes)),
    limits.maxReadableFileBytes,
  );

  const byIdentity = new Map<string, Listing[]>();
  for (const listing of listings) {
    const unavailable = listing.files.find(({ entry }) => !digests.has(entry.hash));
    if (listing.problem === undefined && unavailable !== undefined) {
      listing.problem = "file_unavailable";
      listing.detail = unavailable.entry.path;
    }
    // A root skill takes its name as its URI's directory segment, which a real directory of that
    // name would also claim.
    const name = listing.skill.name;
    if (
      listing.directory.length === 0 &&
      name !== undefined &&
      candidates.some(({ entry }) => entry.path.startsWith(`${name}/`))
    ) {
      listing.problem = "uri_collision";
      listing.detail = name;
    }
    const identity = JSON.stringify(
      listing.files
        .map(({ entry }) => [relativeRepoPath(listing.directory, entry.path), entry.hash])
        .sort(),
    );
    const group = byIdentity.get(identity) ?? [];
    group.push(listing);
    byIdentity.set(identity, group);
  }
  // Identical copies are listed once, at the visible or else the shortest path, and a skill
  // under a hidden directory only when the repository has no visible skill (ADR-0024).
  for (const group of byIdentity.values()) {
    if (group.length < 2) continue;
    const visible = group.filter((listing) => !isHiddenSkill(listing.directory));
    const [kept] = (visible.length > 0 ? visible : group).sort(
      (a, b) => a.directory.length - b.directory.length || (a.directory < b.directory ? -1 : 1),
    );
    for (const listing of group) {
      if (listing !== kept) {
        listing.problem = "duplicate";
        listing.detail = kept?.skill.path;
      }
    }
  }
  const anyVisible = listings.some((listing) => !isHiddenSkill(listing.directory));
  for (const listing of listings) {
    if (listing.problem !== "duplicate" && anyVisible && isHiddenSkill(listing.directory)) {
      listing.problem = "hidden";
      listing.detail = undefined;
    }
  }
  for (const listing of listings) {
    const text = texts.get(listing.skill.blobSha);
    if (text === undefined) continue;
    const above = [...manifests.values()]
      .filter(
        (manifest) =>
          manifest.frontMatter?.manifestError === undefined &&
          isWithinRepoPath(parentDirectory(manifest.path as RepoPath), listing.directory),
      )
      .sort((a, b) => a.path.length - b.path.length);
    const included = (listing.skill.frontMatter?.include ?? []).map((relative) => {
      const path = joinRepoPath(listing.directory, relative as RepoPath);
      const candidate = byCandidatePath.get(path);
      return { path, text: candidate === undefined ? undefined : texts.get(candidate.entry.hash) };
    });
    const withoutText = included.find((file) => file.text === undefined);
    if (withoutText !== undefined) {
      if (listing.problem === undefined) {
        listing.problem = "file_unavailable";
        listing.detail = withoutText.path;
      }
      continue;
    }
    const input = skillDocumentInput({
      commit,
      skill: { path: listing.skill.path as RepoPath, text },
      manifests: above.flatMap((manifest) => {
        const body = texts.get(manifest.blobSha);
        return body === undefined ? [] : [{ path: manifest.path as RepoPath, text: body }];
      }),
      included: included.map((file) => ({ path: file.path, text: file.text ?? "" })),
    });
    if (input === undefined) continue;
    const bytes = new TextEncoder().encode(assembleSkillDocument(input));
    listing.document = { digest: sha256Hex(bytes), size: bytes.byteLength };
  }
  const listedSkills = new Map<string, NewIndexEntry>();
  for (const { directory, skill, problem, detail, document } of listings) {
    const frontMatter = skill.frontMatter ?? { metadata: {}, warnings: [] };
    const license = licenseOf(directory, skill);
    listedSkills.set(skill.path, {
      ...skill,
      ...(document === undefined ? {} : { digest: document.digest, servedSize: document.size }),
      listed: problem === undefined && document !== undefined,
      licenseKind: license.kind,
      // A copy that is listed once, and a hidden skill next to visible ones, leave search too.
      searchable: skill.searchable && problem !== "duplicate" && problem !== "hidden",
      frontMatter: {
        ...(problem === undefined
          ? frontMatter
          : {
              ...frontMatter,
              warnings: [...frontMatter.warnings, describeListingProblem(problem, detail)],
              unlisted: problem,
            }),
        licenseFact: license,
      },
    });
  }

  const entries: NewIndexEntry[] = files.map((entry) => {
    const skill = skills.get(parentDirectory(entry.path));
    const indexed =
      skill !== undefined && skill.path === entry.path
        ? (listedSkills.get(entry.path) ?? skill)
        : (manifests.get(entry.path) ?? documents.get(entry.path));
    const skillDir = owningSkillDirectory(entry.path, skillDirectories);
    const visible = served(entry.path);
    const body = digests.get(entry.hash);
    const digested = body === undefined ? {} : { digest: body.digest, servedSize: body.size };
    if (indexed !== undefined) {
      const known = indexed.digest === undefined ? { ...indexed, ...digested } : indexed;
      return unreadSkills.has(entry.path)
        ? { ...known, skillDir, visible: true, searchable: visible }
        : { ...known, skillDir, visible };
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
      frontMatter:
        overviewFiles.has(entry.path) && !isServedPath(entry.path, scope)
          ? { metadata: {}, warnings: [], overviewOnly: true }
          : linkedFiles.has(entry.path)
            ? { metadata: {}, warnings: [], linkedOnly: true }
            : undefined,
      searchable: false,
      visible,
      ...digested,
    };
  });

  return {
    entries,
    truncated,
    indexedBytes,
    diagnostics,
    license: repositoryLicense,
    version: INDEX_VERSION,
  };
}
