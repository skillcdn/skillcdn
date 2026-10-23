import {
  assembleSkillDocument,
  BROWSE_DEFAULT_LIMIT,
  type BrowseEntry,
  type BrowseResult,
  browseCatalogFiles,
  type CatalogFile,
  type CatalogState,
  classifyRepoFile,
  contextPage,
  decodeText,
  type Embedder,
  embeddingTextOf,
  FIND_DEFAULT_LIMIT,
  FIND_LIST_SKILLS_MAX,
  FIND_MAX_SKILL_FILES,
  type FileLookup,
  type FileOutline,
  type FileReference,
  type FileResult,
  type FindFile,
  type FindItem,
  type FindRanking,
  type FindResult,
  type FolderOverview,
  folderOverview,
  formatSkillUri,
  frontMatterObject,
  fuseRanks,
  type IncludedFile,
  type IndexDiagnostic,
  type IndexEntry,
  type IndexedFile,
  type IndexLimits,
  type IndexNotReady,
  type IndexOutcome,
  isWithinRepoPath,
  joinRepoPath,
  type LicenseFact,
  licenseOfPath,
  MAX_MATCHED_SECTIONS,
  type MatchedSection,
  type MeaningMatch,
  type MountCatalog,
  type MountManifest,
  type MountOverview,
  type MountSearch,
  type MountSummary,
  matchSections,
  NO_LICENSE,
  type OutlineHeading,
  outlineMarkdown,
  pageOfText,
  parentDirectory,
  parseFrontMatter,
  parseRepoPath,
  parseSkillUri,
  queryLexemes,
  queryWeights,
  READ_FILE_DEFAULT_LIMIT,
  type ReadableIndex,
  type RepoPath,
  type RepoTranslation,
  type Reranker,
  ROOT_PATH,
  repoManifestPath,
  SKILL_PAGE_BYTES,
  SKILL_RANK_BOOST,
  type SkillLookup,
  type SkillResult,
  type SkillRules,
  type SkillServing,
  type SkillTranslation,
  type StoredTranslation,
  sectionExcerpt,
  servesInFull,
  skillDocumentInput,
  skillUriPrefix,
  splitFrontMatter,
} from "@skillcdn/core";
import {
  continuationKey,
  continuationOffset,
  nextContinuation,
  ReaderInputError,
} from "./continuation.js";
import type { MountContext } from "./mount.js";
import { compareByteOrder } from "./order.js";
import {
  countEntries,
  type DirectoryListing,
  findSkills,
  getEntry,
  getManifest,
  getSkillsAt,
  listDirectory,
  listEntries,
  listListedSkills,
  listSkillFiles,
  listSkillResources,
} from "./queries.js";

// The reads of a mount (ADR-0054): what the MCP tools, the REST API and the command answer
// from, over an index wherever it is kept. The index comes from the caller, who knows where it
// is and whether it is ready; the reader knows the reading rules of a result and nothing of
// databases, git hosts or files.

export interface ReaderDependencies<M extends MountContext> {
  readonly limits: IndexLimits;
  /**
   * The index of the mount's commit, waiting up to `waitMs` for one that is being built, or why
   * there is none to read yet.
   */
  readonly index: (mount: M, waitMs: number) => Promise<IndexOutcome>;
  /**
   * The bytes of a body the index names but its store does not hold, when something can fetch
   * them (a deployment asks the git host); left out, such a body is unavailable.
   */
  readonly fetchBody?: (
    mount: M,
    hash: string,
    maxBytes: number,
  ) => Promise<Uint8Array | undefined>;
  /**
   * The search by meaning (ADR-0064, ADR-0065), where a deployment or a person has it: left out,
   * the words answer alone, as they do over an index that keeps no vectors.
   */
  readonly meaning?: ReaderMeaning | undefined;
}

/** What a search by meaning is made with. */
export interface ReaderMeaning {
  /**
   * Embeds the query as the vectors of the index were made. A call that fails, or does not answer
   * in time, leaves the words to answer alone, and the result says so.
   */
  readonly embedder: Pick<Embedder, "embed">;
  /**
   * Scores the first results against the query before the page is cut; left out, or when it does
   * not answer, the fused order stands.
   */
  readonly reranker?: Reranker | undefined;
  /** How many of the first results the reranker scores. Default {@link RERANK_CANDIDATES}. */
  readonly rerankCandidates?: number | undefined;
  /** How many sections the index is asked for by meaning. Default {@link MEANING_SECTION_CANDIDATES}. */
  readonly sectionCandidates?: number | undefined;
}

/** A body the index names is at hand nowhere: not stored, and nothing can fetch it. */
export class BodyUnavailableError extends Error {
  readonly code = "body.unavailable";

  constructor(path: string) {
    super(`The body of ${path} is not available.`);
    this.name = "BodyUnavailableError";
  }
}

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
  /** Where the page was read from: the commit, with the newest one beside it when that is another (ADR-0068). */
  readonly mount: MountSummary;
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
/** How many of the first results the reranker scores unless told otherwise: a few seconds on a CPU. */
export const RERANK_CANDIDATES = 10;
/** How many sections a search by meaning asks the index for: enough documents to fuse with the words'. */
export const MEANING_SECTION_CANDIDATES = 40;
/** How many of a document's sections the words rank before the meaning's are fused in. */
const SECTION_CANDIDATES = 5;
/** What a reranker is given of a result: the heading path and the start of the best section. */
const RERANK_CANDIDATE_CHARS = 1200;

/** A result with the sections of its page computed, and the text the reranker scores it by. */
interface Detailed {
  readonly item: FindItem;
  readonly candidate: string;
}

/** The first `max` characters, never cut through a surrogate pair. */
function cutChars(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The entries the words found and the entries whose sections the meaning found, in one order
 * (ADR-0063, point 5): by reciprocal rank fusion of the two lists, an entry's rank by meaning
 * being that of its nearest section, with the skill boost of the words' ranking kept and ties
 * broken by path, so that the order is the same on every machine.
 */
function fuseEntries(
  entries: readonly IndexEntry[],
  words: readonly IndexEntry[],
  nearest: readonly MeaningMatch[],
): IndexEntry[] {
  const byPath = new Map<string, IndexEntry>(words.map((row) => [row.path, row]));
  const byMeaning: string[] = [];
  for (const match of nearest) {
    if (byMeaning.includes(match.path)) {
      continue;
    }
    if (!byPath.has(match.path)) {
      const entry = getEntry(entries, match.path);
      if (entry === undefined || !entry.searchable) {
        continue;
      }
      byPath.set(match.path, entry);
    }
    byMeaning.push(match.path);
  }
  const fused = fuseRanks([words.map((row) => row.path), byMeaning], {
    boost: (path) => (byPath.get(path)?.kind === "skill" ? SKILL_RANK_BOOST : 1),
    compare: compareByteOrder,
  });
  return fused.flatMap((path) => {
    const row = byPath.get(path);
    return row === undefined ? [] : [row];
  });
}

/**
 * Reorders the first `count` of `detailed` by the reranker's scores, in place, highest first and
 * the fused order among equals. False, and nothing moved, when the reranker did not answer.
 */
async function rerankFirst(
  reranker: Reranker,
  query: string,
  detailed: Detailed[],
  count: number,
): Promise<boolean> {
  const first = detailed.slice(0, Math.min(count, reranker.maxCandidates));
  if (first.length < 2) {
    return false;
  }
  let scores: readonly number[];
  try {
    scores = await reranker.rerank(
      query,
      first.map((entry) => entry.candidate),
    );
  } catch {
    // The reranker is a layer a search does without: the fused order stands.
    return false;
  }
  if (scores.length !== first.length) {
    return false;
  }
  first
    .map((entry, at) => ({ entry, score: scores[at] ?? 0, at }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .forEach((scored, at) => {
      detailed[at] = scored.entry;
    });
  return true;
}

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

/** What the index says about an entry that was read. */
function indexedOf(entry: IndexEntry): IndexedFile {
  return { path: entry.path, kind: entry.kind, skillDir: entry.skillDir ?? null };
}

/** A path stored by the indexer, relative to the mounted root. */
function belowMount(mount: MountContext, stored: string | undefined): RepoPath | undefined {
  const parsed = stored === undefined ? undefined : parseRepoPath(stored);
  return parsed?.ok === true && isWithinRepoPath(mount.address.path, parsed.value)
    ? parsed.value
    : undefined;
}

function toFindItem(mount: MountContext, row: IndexEntry): FindItem | undefined {
  if (row.kind === "skill") {
    const directory = belowMount(mount, row.skillDir);
    return directory === undefined || row.name === undefined
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

/**
 * Answers questions about one resolved mount as data. The MCP tools render these answers as text
 * for a model and the REST API returns them as JSON, so both always say the same thing.
 */
export class Reader<M extends MountContext = MountContext> {
  readonly #dependencies: ReaderDependencies<M>;
  readonly #entries = new Map<string, Promise<readonly IndexEntry[]>>();
  /**
   * What each mount holds, by index and mounted path, for every connection to read. An index
   * never changes, so neither does this; the map is small and only saves reads.
   */
  readonly #catalogs = new Map<string, Promise<Omit<MountCatalog, "mount">>>();
  /** The manifest of each mount, by index and mounted path. Read once, kept while wanted. */
  readonly #manifests = new Map<string, Promise<MountManifest | undefined>>();

  constructor(dependencies: ReaderDependencies<M>) {
    this.#dependencies = dependencies;
  }

  #entriesOf(index: ReadableIndex): Promise<readonly IndexEntry[]> {
    const key = `${index.id} ${index.version}`;
    let loading = this.#entries.get(key);
    if (loading === undefined) {
      loading = index.store.entries();
      remember(this.#entries, key, MAX_CACHED_TREES, loading);
    }
    return loading;
  }

  #scopePath(mount: M, wanted: string | undefined): RepoPath {
    const parsed = parseRepoPath(wanted ?? mount.address.path);
    if (!parsed.ok || !isWithinRepoPath(mount.address.path, parsed.value)) {
      throw new ReaderInputError("Use a repository-root path inside the mounted folder.");
    }
    return parsed.value;
  }

  #pageKey(mount: M, index: ReadableIndex, operation: string, path: string, query = ""): string {
    return continuationKey([index.id, index.version, mount.address.path, operation, path, query]);
  }

  async #references(
    mount: M,
    index: ReadableIndex,
    references: readonly { href: string; path: string }[],
  ): Promise<FileReference[]> {
    const entries = await this.#entriesOf(index);
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

  async #catalogFiles(index: ReadableIndex): Promise<CatalogFile[]> {
    const rows = await this.#entriesOf(index);
    return rows.map((row) => ({
      path: row.path as RepoPath,
      kind: row.kind,
      name: row.name,
      title: row.title,
      description: row.description,
      skillDir: row.skillDir === undefined ? undefined : (row.skillDir as RepoPath),
      searchable: row.searchable,
      size: row.size,
      linkedOnly: row.frontMatter?.linkedOnly,
      overviewOnly: row.frontMatter?.overviewOnly,
      language: row.frontMatter?.language,
      license: row.frontMatter?.licenseFact,
    }));
  }

  async #browseEntries(index: ReadableIndex, path: RepoPath): Promise<BrowseEntry[]> {
    return browseCatalogFiles(await this.#catalogFiles(index), path);
  }

  /** The license of the skill that owns a path, when one does. */
  async #skillLicenseAt(index: ReadableIndex, path: RepoPath): Promise<LicenseFact | undefined> {
    const owner = (await this.#entriesOf(index))
      .filter(
        (row) =>
          row.kind === "skill" &&
          row.skillDir !== undefined &&
          isWithinRepoPath(row.skillDir as RepoPath, path),
      )
      .sort((a, b) => (b.skillDir?.length ?? 0) - (a.skillDir?.length ?? 0))[0];
    return owner?.frontMatter?.licenseFact;
  }

  /** The license that governs a path: its skill's own, else the repository's (ADR-0026). */
  async #licenseAt(index: ReadableIndex, path: RepoPath): Promise<LicenseFact> {
    const owned = await this.#skillLicenseAt(index, path);
    if (owned !== undefined) return owned;
    const entries = (await this.#entriesOf(index)).map((row) => ({
      path: row.path,
      kind: row.kind,
      license: row.frontMatter?.license,
    }));
    return licenseOfPath(entries, path, index.license ?? NO_LICENSE);
  }

  async #overviewOf(index: ReadableIndex, path: RepoPath): Promise<FolderOverview | undefined> {
    const files = await this.#catalogFiles(index);
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
    asked: M,
    input: {
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
      /** The most headings on a page of an outline, when the path names a file; `limit` when absent. */
      readonly headings?: number | undefined;
    },
    waitMs: number,
    fits?: (result: BrowseResult) => boolean,
  ): Promise<IndexNotReady | { readonly status: "ready"; readonly result: BrowseResult }> {
    const path = this.#scopePath(asked, input.path);
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") return outcome;
    const { index, mount } = outcome;
    // A path that names a file is answered with the file's outline (ADR-0063).
    const file = path.length === 0 ? undefined : getEntry(await this.#entriesOf(index), path);
    if (file !== undefined && file.frontMatter?.manifestError !== "unsupported_type") {
      return this.#outline(mount, index, file, input, fits);
    }
    const key = this.#pageKey(mount, index, "browse", path);
    const offset = continuationOffset(input.cursor, key);
    const entries = (await this.#browseEntries(index, path)).map((entry) =>
      entry.license !== undefined && !servesInFull(entry.license, mount.verified)
        ? { ...entry, describedOnly: true }
        : entry,
    );
    const limit = input.limit ?? BROWSE_DEFAULT_LIMIT;
    const overview = await this.#overviewOf(index, path);
    const diagnostics = await this.#diagnosticsOf(mount, index);
    const make = (count: number): BrowseResult => ({
      mount: this.summary(mount, index),
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
   * The text of a file the index names: from the store, else fetched from the source and kept,
   * when something can fetch it. `undefined` for bytes that are not UTF-8 text.
   */
  async #textOf(
    mount: M,
    index: ReadableIndex,
    entry: IndexEntry,
    limits: IndexLimits,
  ): Promise<string | undefined> {
    const text = await index.blobs.read(entry.blobSha);
    if (text !== undefined) {
      return text;
    }
    const bytes = await this.#dependencies.fetchBody?.(
      mount,
      entry.blobSha,
      limits.maxReadableFileBytes,
    );
    if (bytes === undefined) {
      throw new BodyUnavailableError(entry.path);
    }
    return decodeText(bytes);
  }

  /**
   * The outline of a file `browse_repo` was given the path of (ADR-0063): its headings with the
   * offset and the length that read each section, in pages; or why there are none to list. What
   * a license keeps at the source is not outlined: its headings are its content.
   */
  async #outline(
    mount: M,
    index: ReadableIndex,
    entry: IndexEntry,
    input: {
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
      readonly headings?: number | undefined;
    },
    fits?: (result: BrowseResult) => boolean,
  ): Promise<{ readonly status: "ready"; readonly result: BrowseResult }> {
    const path = entry.path as RepoPath;
    const limits = { ...this.#dependencies.limits, ...mount.limits };
    const key = this.#pageKey(mount, index, "outline", path);
    const offset = continuationOffset(input.cursor, key);
    const limit = input.headings ?? input.limit ?? BROWSE_DEFAULT_LIMIT;
    const none: FileOutline = {
      path,
      size: entry.size,
      totalLength: undefined,
      headings: [],
      truncated: false,
    };
    let outline = none;
    let headings: readonly OutlineHeading[] = [];
    const license = await this.#licenseAt(index, path);
    if (!servesInFull(license, mount.verified)) {
      outline = {
        ...none,
        unavailable: "described_only",
        license,
        sourceUrl: mount.sourceUrl(path),
      };
    } else if (
      entry.kind !== "skill" &&
      entry.kind !== "manifest" &&
      classifyRepoFile(path) !== "markdown"
    ) {
      outline = { ...none, unavailable: "not_markdown" };
    } else if (entry.size > limits.maxReadableFileBytes) {
      outline = { ...none, unavailable: "too_large", sourceUrl: mount.rawUrl(path) };
    } else {
      const text = await this.#textOf(mount, index, entry, limits);
      if (text === undefined) {
        outline = { ...none, unavailable: "not_text", sourceUrl: mount.rawUrl(path) };
      } else {
        const whole = outlineMarkdown(text);
        headings = whole.headings;
        outline = { ...none, totalLength: whole.totalLength, truncated: whole.truncated };
      }
    }
    const make = (count: number): BrowseResult => ({
      mount: this.summary(mount, index),
      path,
      outline: { ...outline, headings: headings.slice(offset, offset + count) },
      entries: [],
      nextCursor:
        offset + count < headings.length ? nextContinuation(key, offset + count) : undefined,
    });
    return {
      status: "ready",
      result: boundedPage(Math.min(limit, Math.max(0, headings.length - offset)), make, fits),
    };
  }

  /**
   * The language that governs a path, as `language` inherits: the nearest manifest at or above
   * it that declares one. It chooses the word rules a query is read with, as it chose the rules
   * the vectors were built with.
   */
  #languageAt(entries: readonly IndexEntry[], path: RepoPath): string | undefined {
    let directory = path;
    while (true) {
      const manifest = getEntry(entries, repoManifestPath(directory));
      const language = manifest?.kind === "manifest" ? manifest.frontMatter?.language : undefined;
      if (language !== undefined) {
        return language;
      }
      if (directory.length === 0) {
        return undefined;
      }
      directory = parentDirectory(directory);
    }
  }

  /**
   * The sections of a mount nearest in meaning to a query (ADR-0064), where the index keeps the
   * vectors of its sections and an embedder is at hand: `attempted` says whether it was asked,
   * and `nearest` is undefined when the embedder, or the store, did not answer, which is the
   * words' moment to answer alone. Nothing here throws: the layer is one a search does without.
   */
  async #meaningOf(
    index: ReadableIndex,
    path: RepoPath,
    query: string,
  ): Promise<{
    readonly attempted: boolean;
    readonly nearest: readonly MeaningMatch[] | undefined;
  }> {
    const meaning = this.#dependencies.meaning;
    const search = index.store.searchByMeaning;
    if (meaning === undefined || search === undefined) {
      return { attempted: false, nearest: undefined };
    }
    try {
      const { vectors } = await meaning.embedder.embed([query], "query");
      const vector = vectors[0];
      if (vector === undefined) {
        return { attempted: true, nearest: undefined };
      }
      const nearest = await search.call(
        index.store,
        path,
        vector,
        meaning.sectionCandidates ?? MEANING_SECTION_CANDIDATES,
      );
      return { attempted: true, nearest };
    } catch {
      return { attempted: true, nearest: undefined };
    }
  }

  /**
   * A result with the sections that matched (ADR-0063), from the document's text: the sections
   * the words rank and the sections the meaning found, fused into one order, the first two of
   * them named; and the text the reranker scores the result by, its best section. A document
   * that is not Markdown, one this mount describes without serving, since its offsets could not
   * be read here, and one whose body is not at hand name no sections and are scored by what the
   * result says of them.
   */
  async #sectionsOf(
    mount: M,
    index: ReadableIndex,
    entries: readonly IndexEntry[],
    item: FindItem,
    context: {
      readonly lexemes: readonly string[];
      readonly weights: readonly number[] | undefined;
      readonly language: string | undefined;
      readonly meaning: { readonly nearest: readonly MeaningMatch[] | undefined };
    },
  ): Promise<Detailed> {
    if (item.kind !== "document") {
      return { item, candidate: `${item.name}: ${item.description}` };
    }
    const summarized = [item.title, item.summary].filter((part) => part !== undefined).join(": ");
    const plain: Detailed = { item, candidate: summarized.length > 0 ? summarized : item.path };
    const entry = getEntry(entries, item.path);
    if (entry?.kind !== "markdown") {
      return plain;
    }
    if (!servesInFull(await this.#licenseAt(index, item.path), mount.verified)) {
      return plain;
    }
    const text = await index.blobs.read(entry.blobSha);
    if (text === undefined) {
      return plain;
    }
    const byWords = matchSections(text, context.lexemes, {
      language: context.language,
      weights: context.weights,
      limit: SECTION_CANDIDATES,
    });
    const byMeaning = (context.meaning.nearest ?? []).filter((match) => match.path === item.path);
    const offsets = fuseRanks(
      [byWords.map((section) => section.offset), byMeaning.map((match) => match.offset)],
      { compare: (a, b) => a - b },
    );
    const sections = offsets.slice(0, MAX_MATCHED_SECTIONS).flatMap((offset): MatchedSection[] => {
      const matched = byWords.find((section) => section.offset === offset);
      if (matched !== undefined) {
        return [matched];
      }
      const near = byMeaning.find((match) => match.offset === offset);
      return near === undefined
        ? []
        : [
            {
              heading: near.heading,
              offset: near.offset,
              length: near.length,
              excerpt: sectionExcerpt(text, near, context.lexemes, context.language),
            },
          ];
    });
    const best = sections[0];
    const candidate =
      best === undefined
        ? `${item.title ?? item.path}: ${item.summary ?? cutChars(text, RERANK_CANDIDATE_CHARS)}`
        : cutChars(embeddingTextOf(item.title, best, text), RERANK_CANDIDATE_CHARS);
    return { item: { ...item, sections }, candidate };
  }

  /**
   * The repository manifest that governs a mount: the one in the mounted directory, else the
   * nearest above it. Its rules come from the bodies, so that `get` can hand them over.
   */
  #manifestOf(mount: M, index: ReadableIndex): Promise<MountManifest | undefined> {
    const key = `${index.id} ${index.version} ${mount.address.path}`;
    const cached = this.#manifests.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const loading = this.#entriesOf(index).then(async (entries) => {
      const row = getManifest(entries, mount.address.path);
      if (row === undefined || row.description === undefined) {
        return undefined;
      }
      const text = await index.blobs.read(row.blobSha);
      const split = text === undefined ? undefined : splitFrontMatter(text);
      const ancestors = entries
        .filter(
          (entry) =>
            entry.kind === "manifest" &&
            isWithinRepoPath(parentDirectory(entry.path as RepoPath), mount.address.path),
        )
        .sort((a, b) => b.path.length - a.path.length);
      return {
        path: parseRepoPath(row.path).ok ? (row.path as RepoPath) : undefined,
        name: row.name,
        description: row.description,
        language: ancestors.find((entry) => entry.frontMatter?.language !== undefined)?.frontMatter
          ?.language,
        image: ancestors.find((entry) => entry.frontMatter?.image !== undefined)?.frontMatter
          ?.image,
        translations: repoTranslationsOf(row.frontMatter?.translations),
        rules: split?.kind === "found" ? split.body.trim() : "",
      };
    });
    remember(this.#manifests, key, MAX_CACHED_MANIFESTS, loading);
    return loading;
  }

  /** The manifests inside the mount that could not be read. Findings above the mount are not ours. */
  async #diagnosticsOf(mount: M, index: ReadableIndex): Promise<IndexDiagnostic[]> {
    const all = await index.store.diagnostics();
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
  async catalog(asked: M): Promise<CatalogState> {
    const outcome = await this.#index(asked, 0);
    if (outcome.status !== "ready") {
      return {
        status: outcome.status,
        mount: this.summary(asked, undefined),
        description: asked.description,
      };
    }
    const { index, mount } = outcome;
    const path = mount.address.path;
    const key = `${index.id} ${index.version} ${path}`;
    let loading = this.#catalogs.get(key);
    if (loading === undefined) {
      loading = this.#entriesOf(index).then(async (entries) => {
        const [manifest, diagnostics] = await Promise.all([
          this.#manifestOf(mount, index),
          this.#diagnosticsOf(mount, index),
        ]);
        const skills = listEntries(entries, path, FIND_LIST_SKILLS_MAX, "skills");
        const counts = countEntries(entries, path);
        return {
          overview: await this.#overviewOf(index, path),
          description: mount.description,
          groups: (await this.#browseEntries(index, path)).slice(0, BROWSE_DEFAULT_LIMIT),
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
            return directory === undefined || row.name === undefined
              ? []
              : [{ name: row.name, directory, description: row.description ?? "" }];
          }),
          skillCount: counts.skills,
          documentCount: counts.documents,
          diagnostics,
        };
      });
      remember(this.#catalogs, key, MAX_CACHED_CATALOGS, loading);
    }
    // How the mount is searched changes as its embedding comes along, so it is not kept with the rest.
    const search = await this.#searchOf(index);
    return {
      status: "ready",
      catalog: {
        mount: this.summary(mount, index),
        ...(await loading),
        ...(search === undefined ? {} : { search }),
      },
    };
  }

  /**
   * How the mount is searched right now (ADR-0064): nothing to say where the words answer alone;
   * else whether the vectors of the index take part, which they do once any exist, and how far
   * the embedding has come where the store counts it.
   */
  async #searchOf(index: ReadableIndex): Promise<MountSearch | undefined> {
    const { store } = index;
    if (this.#dependencies.meaning === undefined || store.searchByMeaning === undefined) {
      return undefined;
    }
    if (store.embeddingProgress === undefined) {
      return { meaning: true, embedding: undefined };
    }
    const embedding = await store.embeddingProgress();
    return {
      meaning:
        embedding !== undefined && (embedding.status === "complete" || embedding.embedded > 0),
      embedding,
    };
  }

  summary(mount: M, index: ReadableIndex | undefined): MountSummary {
    return {
      repository: mount.repository,
      ref:
        mount.address.ref === undefined
          ? undefined
          : mount.address.ref.kind === "commit"
            ? mount.address.ref.hash
            : mount.address.ref.name,
      commit: mount.commit,
      ...(mount.newest === undefined ? {} : { newest: mount.newest }),
      path: mount.address.path,
      verified: mount.verified,
      ...(mount.visibility === undefined ? {} : { visibility: mount.visibility }),
      truncated: index?.truncated ?? false,
      skillUri: skillUriPrefix(mount.address),
    };
  }

  /**
   * How much each word of a query counts: by its rarity among the findable entries under the
   * path (ADR-0069), where the store counts them; every word the same where it does not.
   */
  async #weightsOf(
    index: ReadableIndex,
    path: RepoPath,
    lexemes: readonly string[],
  ): Promise<readonly number[] | undefined> {
    const count = index.store.frequencies;
    if (count === undefined || lexemes.length === 0) {
      return undefined;
    }
    const { total, counts } = await count.call(index.store, path, lexemes);
    return queryWeights(total, counts);
  }

  /**
   * The index of the mount's commit, with the mount a result names: the one asked for, or, when
   * the caller hands over an index served in place of that commit's (ADR-0068), the same mount at
   * the commit that index was built from, with the newest commit beside it. Everything read from
   * the index is named after the commit it was built from, and nothing after the one asked for.
   */
  async #index(
    asked: M,
    waitMs: number,
  ): Promise<
    IndexNotReady | { readonly status: "ready"; readonly index: ReadableIndex; readonly mount: M }
  > {
    const outcome = await this.#dependencies.index(asked, waitMs);
    if (outcome.status !== "ready") return outcome;
    const { substitute } = outcome;
    const mount: M =
      substitute === undefined
        ? asked
        : { ...asked, commit: substitute.commit, newest: substitute.newest };
    return { status: "ready", index: outcome.index, mount };
  }

  // The MCP skills extension (ADR-0024): the same index, served as skills and resources.

  /**
   * The repository-root path a skill URI names inside this mount, or `undefined` when the URI
   * is not one of this repository's. A root skill's files carry its name as a directory segment
   * the repository does not have; a real path of that spelling comes first.
   */
  async #pathOfUri(mount: M, index: ReadableIndex, uri: string): Promise<RepoPath | undefined> {
    const parsed = parseSkillUri(uri);
    if (
      parsed === undefined ||
      parsed.address.host !== mount.address.host ||
      parsed.address.owner !== mount.address.owner ||
      parsed.address.repo !== mount.address.repo
    ) {
      return undefined;
    }
    const root = await this.#rootSkill(index);
    if (root !== undefined && (parsed.path === root || parsed.path.startsWith(`${root}/`))) {
      const real = getEntry(await this.#entriesOf(index), parsed.path);
      if (real === undefined) {
        const below = parsed.path === root ? ROOT_PATH : parsed.path.slice(root.length + 1);
        const path = parseRepoPath(below);
        return path.ok ? path.value : undefined;
      }
    }
    return parsed.path;
  }

  /** The name of the skill at the repository root, when there is one. */
  async #rootSkill(index: ReadableIndex): Promise<string | undefined> {
    const root = getEntry(await this.#entriesOf(index), "SKILL.md");
    return root?.kind === "skill" && root.name !== undefined ? root.name : undefined;
  }

  /** The URI of a repository-root path, with a root skill's name segment in front. */
  #uriOf(mount: M, root: string | undefined, path: RepoPath): string {
    const named = root === undefined ? path : joinRepoPath(root as RepoPath, path);
    return formatSkillUri(mount.address, named);
  }

  /** What the listing says about one listed skill: its URI, its front matter and its files. */
  async #skillEntry(
    mount: M,
    index: ReadableIndex,
    root: string | undefined,
    skill: IndexEntry,
  ): Promise<SkillEntry | undefined> {
    const text = await index.blobs.read(skill.blobSha);
    const split = text === undefined ? undefined : splitFrontMatter(text);
    const fields = split?.kind === "found" ? parseFrontMatter(split.source) : undefined;
    if (fields === undefined || !fields.ok) return undefined;
    const files = listSkillResources(await this.#entriesOf(index), skill.skillDir ?? "");
    return {
      uri: this.#uriOf(mount, root, skill.path as RepoPath),
      frontmatter: frontMatterObject(fields.value),
      resources: files.flatMap((file) =>
        file.digest === undefined || file.servedSize === undefined
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
    asked: M,
    input: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    waitMs: number,
  ): Promise<IndexNotReady | { readonly status: "ready"; readonly result: SkillsPage }> {
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") return outcome;
    const { index, mount } = outcome;
    const key = this.#pageKey(mount, index, "skills/list", mount.address.path);
    const offset = continuationOffset(input.cursor, key);
    const limit = input.limit ?? SKILLS_PAGE_SIZE;
    const entries = await this.#entriesOf(index);
    const root = await this.#rootSkill(index);
    const page = listListedSkills(entries, mount.address.path, offset, limit, {
      includeRestricted: mount.verified,
    });
    const skills = (
      await Promise.all(page.skills.map((skill) => this.#skillEntry(mount, index, root, skill)))
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
        mount: this.summary(mount, index),
      },
    };
  }

  /**
   * One listed skill by URI, with the directory it lives in; `undefined` when the URI names no
   * listed skill of this mount.
   */
  async getSkill(
    asked: M,
    uri: string,
    waitMs: number,
  ): Promise<
    | IndexNotReady
    | {
        readonly status: "ready";
        readonly skill: SkillEntry | undefined;
        readonly directory: string | undefined;
      }
  > {
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") return outcome;
    const { index, mount } = outcome;
    const path = await this.#pathOfUri(mount, index, uri);
    const entry =
      path === undefined || !isWithinRepoPath(mount.address.path, path)
        ? undefined
        : getEntry(await this.#entriesOf(index), path);
    if (entry?.kind !== "skill" || entry.listed !== true) {
      return { status: "ready", skill: undefined, directory: undefined };
    }
    // A described skill is not listed here, so its URI names nothing (ADR-0026).
    if (!servesInFull(entry.frontMatter?.licenseFact ?? NO_LICENSE, mount.verified)) {
      return { status: "ready", skill: undefined, directory: undefined };
    }
    return {
      status: "ready",
      skill: await this.#skillEntry(mount, index, await this.#rootSkill(index), entry),
      directory: entry.skillDir ?? ROOT_PATH,
    };
  }

  /**
   * The bytes a URI names, as the listing digested them, with what the index says about the
   * file; `undefined` when the URI names nothing served.
   */
  async readResource(
    asked: M,
    uri: string,
    waitMs: number,
  ): Promise<
    | IndexNotReady
    | {
        readonly status: "ready";
        readonly resource: Resource | undefined;
        readonly indexed: IndexedFile | undefined;
      }
  > {
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") return outcome;
    const { index, mount } = outcome;
    const path = await this.#pathOfUri(mount, index, uri);
    const entry =
      path === undefined || !isWithinRepoPath(mount.address.path, path)
        ? undefined
        : getEntry(await this.#entriesOf(index), path);
    if (entry === undefined || entry.digest === undefined)
      return { status: "ready", resource: undefined, indexed: undefined };
    const license = await this.#licenseAt(index, entry.path as RepoPath);
    if (!servesInFull(license, mount.verified)) {
      return { status: "ready", resource: undefined, indexed: undefined };
    }
    const indexed = indexedOf(entry);
    if (entry.kind === "skill") {
      const document = await this.#assembledDocument(mount, index, entry);
      return {
        status: "ready",
        resource:
          document === undefined
            ? undefined
            : { uri, mimeType: "text/markdown", text: document, digest: entry.digest },
        indexed: document === undefined ? undefined : indexed,
      };
    }
    const bytes = await index.blobs.readBytes(entry.blobSha);
    if (bytes === undefined) return { status: "ready", resource: undefined, indexed: undefined };
    const text = decodeText(bytes);
    return {
      status: "ready",
      resource: {
        uri,
        mimeType: mimeTypeOf(entry.path as RepoPath, text !== undefined),
        ...(text === undefined ? { blob: Buffer.from(bytes).toString("base64") } : { text }),
        digest: entry.digest,
      },
      indexed,
    };
  }

  /** The direct children of a directory URI, or `undefined` when it names no directory served here. */
  async readDirectory(
    asked: M,
    uri: string,
    waitMs: number,
  ): Promise<
    | IndexNotReady
    | { readonly status: "ready"; readonly entries: readonly ResourceEntry[] | undefined }
  > {
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") return outcome;
    const { index, mount } = outcome;
    const root = await this.#rootSkill(index);
    const path = await this.#pathOfUri(mount, index, uri);
    if (path === undefined || !isWithinRepoPath(mount.address.path, path)) {
      return { status: "ready", entries: undefined };
    }
    const owned = await this.#skillLicenseAt(index, path);
    if (owned !== undefined && !servesInFull(owned, mount.verified)) {
      return { status: "ready", entries: undefined };
    }
    // What a directory holds here is what the extension serves: a file over the read limit is
    // named in the skill's document instead (ADR-0033).
    const children = listDirectory(await this.#entriesOf(index), path, MAX_DIRECTORY_ENTRIES, {
      servedOnly: true,
    });
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
    mount: M,
    index: ReadableIndex,
    skill: IndexEntry,
  ): Promise<string | undefined> {
    const text = await index.blobs.read(skill.blobSha);
    if (text === undefined || skill.skillDir === undefined) return undefined;
    const directory = skill.skillDir as RepoPath;
    const entries = await this.#entriesOf(index);
    const manifests = entries
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
        text: await index.blobs.read(row.blobSha),
      })),
    );
    // Included paths are repository-root paths: a file of the skill, or a shared page outside
    // it that the index admitted (ADR-0044); either way the index holds it.
    const included = await Promise.all(
      (skill.frontMatter?.include ?? []).map(async (include) => {
        const parsed = parseRepoPath(include);
        const entry = parsed.ok ? getEntry(entries, parsed.value) : undefined;
        return {
          path: parsed.ok ? parsed.value : directory,
          text: entry === undefined ? undefined : await index.blobs.read(entry.blobSha),
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
      // As the index recorded them, so that the document is the one the index digested.
      omitted: skill.frontMatter?.omitted,
    });
    return input === undefined ? undefined : assembleSkillDocument(input);
  }

  async find(
    asked: M,
    input: {
      readonly query?: string | undefined;
      readonly limit?: number | undefined;
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
    },
    waitMs: number,
    fits?: (result: FindResult) => boolean,
  ): Promise<IndexNotReady | { readonly status: "ready"; readonly result: FindResult }> {
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const { index, mount } = outcome;
    const trimmed = input.query?.trim();
    const query = trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
    const limit = input.limit ?? FIND_DEFAULT_LIMIT;
    const path = this.#scopePath(mount, input.path);
    const key = this.#pageKey(mount, index, "search", path, query ?? "");
    const offset = continuationOffset(input.cursor, key);
    const entries = await this.#entriesOf(index);
    let items: FindItem[];
    let totals: FindResult["totals"];
    let ranking: FindRanking | undefined;
    if (query === undefined) {
      // A listing names every skill: a skill's own files are reached through the skill.
      const skills = listEntries(entries, path, Number.MAX_SAFE_INTEGER, "skills");
      const documents = listEntries(
        entries,
        path,
        Number.MAX_SAFE_INTEGER,
        "documents_outside_skills",
      );
      items = [...skills, ...documents]
        .map((row) => toFindItem(mount, row))
        .filter((item) => item !== undefined);
      totals = countEntries(entries, path);
    } else {
      // The words of the query, read with the rules of the language that governs the searched
      // folder, as the vectors were built (ADR-0063).
      const language = this.#languageAt(entries, path);
      const lexemes = queryLexemes(query, language);
      // Each word weighs by its rarity among the entries searched (ADR-0069), where the store counts.
      const weights = await this.#weightsOf(index, path, lexemes);
      const words = await index.store.search(path, lexemes, weights);
      // And the sections nearest in meaning, where the index keeps vectors and an embedder is at
      // hand (ADR-0064): fused with the words' results, or left out when the embedder did not
      // answer, which the result says.
      const meaning = await this.#meaningOf(index, path, query);
      const rows =
        meaning.nearest === undefined ? words : fuseEntries(entries, words, meaning.nearest);
      items = this.#fold({ ...mount, address: { ...mount.address, path } }, entries, rows);
      totals = undefined;
      // The sections that matched, for the documents of this page and for the first results the
      // reranker scores: their texts are read for it.
      const reranker = this.#dependencies.meaning?.reranker;
      const candidates =
        reranker === undefined
          ? 0
          : (this.#dependencies.meaning?.rerankCandidates ?? RERANK_CANDIDATES);
      const detailed = await Promise.all(
        items
          .slice(0, Math.max(offset + limit, candidates))
          .map((item) =>
            this.#sectionsOf(mount, index, entries, item, { lexemes, weights, language, meaning }),
          ),
      );
      const reranked =
        reranker === undefined ? false : await rerankFirst(reranker, query, detailed, candidates);
      items = [...detailed.map((entry) => entry.item), ...items.slice(detailed.length)];
      ranking = meaning.attempted
        ? { meaning: meaning.nearest !== undefined, reranked }
        : undefined;
    }
    const diagnostics = await this.#diagnosticsOf(mount, index);
    const make = (count: number): FindResult => ({
      mount: this.summary(mount, index),
      query,
      items: items.slice(offset, offset + count),
      path,
      nextCursor: offset + count < items.length ? nextContinuation(key, offset + count) : undefined,
      totals,
      diagnostics,
      ...(ranking === undefined ? {} : { ranking }),
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
  #fold(
    mount: MountContext,
    entries: readonly IndexEntry[],
    rows: readonly IndexEntry[],
  ): FindItem[] {
    interface Group {
      skill: IndexEntry | undefined;
      readonly files: IndexEntry[];
    }
    const groups = new Map<string, Group>();
    const order: ({ readonly group: string } | { readonly row: IndexEntry })[] = [];
    for (const row of rows) {
      const owner = row.skillDir;
      if (owner === undefined || belowMount(mount, owner) === undefined) {
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
    for (const row of getSkillsAt(entries, unmatched)) {
      const group = row.skillDir === undefined ? undefined : groups.get(row.skillDir);
      if (group !== undefined) {
        group.skill = row;
      }
    }

    const items: FindItem[] = [];
    const push = (row: IndexEntry): void => {
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
    asked: M,
    wanted: string,
    waitMs: number,
    cursor?: string,
    exactPath = false,
    fits?: (result: SkillResult) => boolean,
  ): Promise<IndexNotReady | { readonly status: "ready"; readonly lookup: SkillLookup }> {
    const outcome = await this.#index(asked, waitMs);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const { index, mount } = outcome;
    const entries = await this.#entriesOf(index);
    const name = exactPath ? wanted : wanted.trim();
    const asDirectory = parseRepoPath(name);
    const directory =
      asDirectory.ok && isWithinRepoPath(mount.address.path, asDirectory.value)
        ? asDirectory.value
        : undefined;
    const byPath = directory === undefined ? undefined : getEntry(entries, directory);
    const found =
      byPath?.kind === "skill"
        ? [byPath]
        : exactPath
          ? []
          : findSkills(entries, mount.address.path, { name, directory }, 10);
    const exact = found.filter((row) => row.name === name || row.skillDir === directory);
    const matches = exact.length > 0 ? exact : found;

    if (matches.length === 0) {
      const listed = listEntries(entries, mount.address.path, MAX_SUGGESTED_SKILLS, "skills");
      const diagnostics = await this.#diagnosticsOf(mount, index);
      const available = listed.flatMap((row) => (row.name === undefined ? [] : [row.path]));
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
    if (skillDirectory === undefined || skill.name === undefined) {
      return { status: "ready", lookup: { kind: "unavailable" } };
    }
    const skillName = skill.name;
    const license = skill.frontMatter?.licenseFact ?? NO_LICENSE;
    const serving: SkillServing = {
      license,
      full: servesInFull(license, mount.verified),
      sourceUrl: mount.sourceUrl(skill.path as RepoPath),
    };
    if (!serving.full) {
      // The license lets the reader know that the skill exists and where; the rest stays at the
      // source (ADR-0026).
      return {
        status: "ready",
        lookup: {
          kind: "found",
          skill: {
            mount: this.summary(mount, index),
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
    const text = await index.blobs.read(skill.blobSha);
    if (text === undefined) {
      return { status: "ready", lookup: { kind: "unavailable" } };
    }
    const split = splitFrontMatter(text);
    const files = listSkillFiles(entries, skill.skillDir ?? "", MAX_LISTED_SKILL_FILES + 1);
    const included = await this.#includedFiles(index, skill.frontMatter?.include ?? []);
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
          ? await index.blobs.read(ancestor.blobSha)
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
    const key = this.#pageKey(mount, index, "get_skill", skill.path);
    const start = continuationOffset(cursor, key);
    const referenceSources = [
      skill,
      ...ancestors,
      ...entries.filter((entry) => included.some((file) => file.path === entry.path)),
    ];
    const references = await this.#references(
      mount,
      index,
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
        mount: this.summary(mount, index),
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
        ...(skill.frontMatter?.omitted === undefined
          ? {}
          : { oversized: skill.frontMatter.omitted }),
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
   * The paths are repository-root paths; a shared page outside the skill directory arrives with
   * the skill even on a mount that does not contain it, as the ancestor rules do (ADR-0044),
   * though `read_repo_file` still cannot read it there by its path.
   */
  async #includedFiles(index: ReadableIndex, include: readonly string[]): Promise<IncludedFile[]> {
    const entries = await this.#entriesOf(index);
    const read = await Promise.all(
      include.map(async (include) => {
        const parsed = parseRepoPath(include);
        if (!parsed.ok) {
          return undefined;
        }
        const entry = getEntry(entries, parsed.value);
        const text =
          entry?.kind === "markdown" || entry?.kind === "json"
            ? await index.blobs.read(entry.blobSha)
            : undefined;
        return { path: parsed.value, text };
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
    asked: M,
    input: {
      readonly path: string;
      readonly offset?: number | undefined;
      readonly limit?: number | undefined;
    },
    fits?: (result: FileResult) => boolean,
  ): Promise<FileLookup> {
    const limits = { ...this.#dependencies.limits, ...asked.limits };
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
    if (!isWithinRepoPath(asked.address.path, path)) return { kind: "not_found", path };

    const outcome = await this.#index(asked, 0);
    // Publication policy may exclude any path, including declarations. Never guess before it
    // has been validated; a body at hand is not permission to serve a file.
    if (outcome.status !== "ready") return { kind: "not_ready", outcome };
    const { index, mount } = outcome;
    const entries = await this.#entriesOf(index);
    let children: readonly DirectoryListing[] = [];
    const entry = below.length === 0 ? undefined : getEntry(entries, path);
    if (entry?.frontMatter?.manifestError === "unsupported_type")
      return { kind: "not_found", path };
    if (entry === undefined) {
      children = listDirectory(entries, path, MAX_DIRECTORY_ENTRIES + 1);
    }
    if (entry === undefined) {
      const listed = children.flatMap((child) => {
        const childPath = belowMount(mount, child.path);
        return childPath === undefined
          ? []
          : [{ path: childPath, kind: child.kind, size: child.size }];
      });
      if (listed.length === 0) {
        const suggestions = entries
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
          mount: this.summary(mount, index),
          path: below,
          entries: listed.slice(0, MAX_DIRECTORY_ENTRIES),
          truncated: listed.length > MAX_DIRECTORY_ENTRIES,
        },
      };
    }
    const file = { size: entry.size, hash: entry.blobSha };
    const license = await this.#licenseAt(index, path);
    if (!servesInFull(license, mount.verified)) {
      return { kind: "not_served", path: below, license, sourceUrl: mount.sourceUrl(path) };
    }
    if (file.size > limits.maxReadableFileBytes) {
      return {
        kind: "too_large",
        path: below,
        size: file.size,
        limit: limits.maxReadableFileBytes,
        sourceUrl: mount.rawUrl(path),
      };
    }

    const text = await this.#textOf(mount, index, entry, limits);
    if (text === undefined) {
      return { kind: "not_text", path: below, sourceUrl: mount.rawUrl(path) };
    }
    const references = await this.#references(mount, index, entry.frontMatter?.references ?? []);
    const make = (length: number): FileResult => {
      const page = pageOfText(text, input.offset ?? 0, length);
      return {
        // A page lists the links within it: a section read is not told of the rest of the file's.
        references:
          page.content.length === text.length
            ? references
            : references.filter((reference) => page.content.includes(reference.href)),
        mount: this.summary(mount, index),
        path: below,
        ...page,
        requestedLength: input.limit,
      };
    };
    const page = boundedPage(input.limit ?? READ_FILE_DEFAULT_LIMIT, make, fits);
    if (page.nextOffset !== undefined && page.content.length === 0) {
      throw new ReaderInputError("This file page cannot advance. Use a larger page limit.");
    }
    return { kind: "found", file: page, indexed: indexedOf(entry) };
  }

  /** Everything the mount offers, up to `listLimit` skills and as many documents. Never waits. */
  async overview(
    asked: M,
    listLimit: number,
  ): Promise<IndexNotReady | { readonly status: "ready"; readonly overview: MountOverview }> {
    const outcome = await this.#index(asked, 0);
    if (outcome.status !== "ready") {
      return outcome;
    }
    const { index, mount } = outcome;
    const path = mount.address.path;
    const entries = await this.#entriesOf(index);
    const [diagnostics, manifest, groups] = await Promise.all([
      this.#diagnosticsOf(mount, index),
      this.#manifestOf(mount, index),
      this.#browseEntries(index, path),
    ]);
    const counts = countEntries(entries, path);
    const skills = listEntries(entries, path, listLimit, "skills");
    const documents = listEntries(entries, path, listLimit, "documents_outside_skills");
    const search = await this.#searchOf(index);
    return {
      status: "ready",
      overview: {
        overview: await this.#overviewOf(index, path),
        ...(search === undefined ? {} : { search }),
        mount: this.summary(mount, index),
        groups: groups.filter((entry) => entry.kind === "directory").slice(0, BROWSE_DEFAULT_LIMIT),
        manifest,
        license: await this.#licenseAt(index, path),
        skillCount: counts.skills,
        documentCount: counts.documents,
        skills: skills.flatMap((row) => {
          const directory = belowMount(mount, row.skillDir);
          return directory === undefined || row.name === undefined
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
