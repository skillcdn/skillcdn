import {
  BROWSE_MAX_LIMIT,
  type BrowseResult,
  browseResultOf,
  COMMAND_OUTPUT_MAX_BYTES,
  catalogStateOf,
  contextPage,
  DATA_CODE_MAX_LIMIT,
  DATA_ROWS_MAX_LIMIT,
  directoryResultOf,
  FIND_MAX_LIMIT,
  type FileResult,
  type FindItem,
  type FindResult,
  fileResultOf,
  fileShown,
  findResultOf,
  joinSkillPages,
  type MountSummary,
  mountSummaryOf,
  READ_FILE_MAX_LIMIT,
  type RestBrowse,
  type RestFind,
  renderBrowseResult,
  renderDiagnostics,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderInstructions,
  renderSkillResult,
  rowsCsv,
  type SkillResult,
  skillOutcome,
  skillResultOf,
  skillShown,
  type ToolWords,
  utf8Length,
} from "@skillcdn/core";
import { type CodePage, type DataQuery, type Pack, PackError, type RowsPage } from "./pack.js";

// The reads of a pack as the command prints them (ADR-0110): what is asked of the pack, page by
// page, and the text an agent is given or the JSON of the API, for the command's arguments as for
// another program's. A program with commands of its own (the reference console) hands in its pack
// and its words and prints what comes back, so that the same read prints the same text under
// either command. What the pack does not have, or refuses, is a PackError; what was not asked
// right is a ReadMisuse; printing, files and exit codes are the caller's.

/** A read that was not asked right: a number out of its range, a pattern that does not parse. */
export class ReadMisuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadMisuse";
  }
}

/** How the results name the reads, so that an agent is told the command and not a tool. */
export const COMMAND_WORDS: ToolWords = {
  browse: "skillcdn browse",
  search: "skillcdn find",
  load: "skillcdn skill",
  read: "skillcdn file",
};

/**
 * @deprecated One read is bounded in bytes, as the hosts that run an agent's commands bound what
 * they show: `COMMAND_OUTPUT_MAX_BYTES` of `@skillcdn/core` (ADR-0124). A character is a byte
 * at least, so no read prints more characters than this either.
 */
export const OUTPUT_CHARS = COMMAND_OUTPUT_MAX_BYTES;
/**
 * The characters of a file one read asks the pack for unless a limit says otherwise. What is
 * printed of them is what the bound of one read takes with its header and links: all of them
 * where a character is a byte, and fewer where it is more.
 */
export const FILE_PAGE_CHARS = 24_000;

/** A ready `browse` answer: a page of a folder, or of the outline of a file. */
type ReadyBrowse = Extract<RestBrowse, { status: "ready" }>;
/** A ready `find` answer: a page of what the words found. */
type ReadyFind = Extract<RestFind, { status: "ready" }>;

/** How many pages of a data read, or of the listing, are joined before the read stops: far above what a pack holds. */
const MAX_DATA_PAGES = 10_000;
/** How many pages of one skill a read follows before it stops, as the client's `skillPages` does: far above what one holds. */
const MAX_SKILL_PAGES = 256;

/** A word of a command line an agent is given to run: quoted where a shell would split or expand it. */
export const shellWord = (word: string): string =>
  /^[\w@%+=:,./~-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** One read of a pack, as a command asks for it. */
export type PackRead =
  /**
   * What a client is told on connect, then every skill and every document: as far as one read
   * prints where `nextPart` says how to read on, else whole; from a cursor, the listing from where
   * the page before it ended (ADR-0124).
   */
  | { readonly read: "skills"; readonly cursor?: string | undefined }
  /** What a folder holds, or the outline of a file: a page. */
  | {
      readonly read: "browse";
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | string | undefined;
    }
  /** What the words find: a page. */
  | {
      readonly read: "find";
      readonly words: string;
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | string | undefined;
    }
  /** One skill, whole or in parts within what one read prints (ADR-0108, ADR-0124). */
  | { readonly read: "skill"; readonly path: string; readonly cursor?: string | undefined }
  /** A page of a file, or what a folder holds. */
  | {
      readonly read: "file";
      readonly path: string;
      readonly offset?: number | string | undefined;
      readonly limit?: number | string | undefined;
    }
  /** Every table under a path, as data (ADR-0080): CSV, rows as JSON, or the API's JSON. */
  | {
      readonly read: "rows";
      readonly path?: string | undefined;
      readonly heading?: string | undefined;
      readonly format?: string | undefined;
    }
  /** Every fenced code block under a path, as data (ADR-0080), those `grep` matches where it is given. */
  | {
      readonly read: "code";
      readonly path?: string | undefined;
      readonly heading?: string | undefined;
      readonly grep?: string | undefined;
    };

export interface ReadOptions {
  /** The words the text names the reads by; the command's own by default. */
  readonly words?: ToolWords | undefined;
  /** The JSON of the REST API instead of the words a model is given. */
  readonly json?: boolean | undefined;
  /**
   * The command that reads on from a cursor: the next part of a skill, said at the head of a part
   * and as its last line, or the next page of the listing of `skills`. For a skill it is by
   * default `<words.load> <path> --cursor <cursor>`, which names no pack; without it the listing
   * is printed whole, since its reader would have no way on from a page. It only makes the line:
   * it is called more than once for a read, and for parts the read tries and does not print.
   */
  readonly nextPart?: ((cursor: string) => string) | undefined;
  /**
   * The command that lists a folder of the pack, by its path from the pack's root, empty for the
   * root: a skill names its own folder with it where it does not list every file or resolve
   * every link. By default `<words.browse> <path>`, which names no pack. It only makes the line.
   */
  readonly browseFolder?: ((path: string) => string) | undefined;
  /**
   * The bytes of UTF-8 the caller prints in the same output beside the text, a line of its own
   * above or below it: the read keeps that much of the bound free, so that the whole output is
   * still one a host shows whole (ADR-0124). None by default.
   */
  readonly room?: number | undefined;
}

export interface ReadOutput {
  /** What the read prints, or what a data read writes to a file. */
  readonly text: string;
  /**
   * For the data reads, what the text holds, as the line that says it was written puts it
   * ({@link wroteLine}): `12 rows of 2 tables`, `3 code blocks`.
   */
  readonly holds?: string | undefined;
  /**
   * Where the read goes on, when what it printed is not all there is: the cursor of the next part
   * of a skill, with the pages of the skill still to read where the pack counts them, the cursor
   * of the next page of a folder, of an outline, of a search or of the listing, or the offset a
   * file continues at. Absent when the read reached the end, and with `json`. The text says the
   * same in words; this is for a program that acts on it.
   */
  readonly next?:
    | {
        readonly cursor?: string | undefined;
        readonly offset?: number | undefined;
        readonly pagesLeft?: number | undefined;
      }
    | undefined;
}

/**
 * A whole number a read takes as given on a command line, or `undefined` where none was: from 0
 * for an offset, from 1 for anything else, up to `max`. Anything else is a ReadMisuse that names
 * the flag: `--limit takes an integer between 1 and 200`.
 */
export function readNumber(
  value: number | string | undefined,
  name: string,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = String(value);
  const number = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (Number.isNaN(number) || number < (name === "offset" ? 0 : 1) || number > max) {
    throw new ReadMisuse(
      `--${name} takes an integer ${name === "offset" ? "from 0" : `between 1 and ${max}`}`,
    );
  }
  return number;
}

/** What a data read says when what it made went to a file instead of the output. */
export const wroteLine = (holds: string, file: string): string => `Wrote ${holds} to ${file}.`;

const counted = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const notReady = (status: string): PackError =>
  new PackError(503, `index.${status}`, "The pack is not ready to read.");

/** A page of the listing: the skills and documents from a cursor on, as a search without words lists them. */
async function listingPage(
  pack: Pack,
  summary: MountSummary,
  cursor: string | undefined,
  limit: number,
): Promise<FindResult> {
  const body = await pack.find({ cursor, limit });
  if (body.status !== "ready") {
    throw notReady(body.status);
  }
  return findResultOf(body, summary);
}

/**
 * The skills and documents the pack lists from `from` on, page after page, as one listing: all
 * of them, or with `fits` as many as one read prints (ADR-0124). Of the page that does not fit,
 * as many results as do are asked for again by their number, so that the pack says where the
 * listing goes on. The first result is listed whatever its length.
 */
async function listing(
  pack: Pack,
  summary: MountSummary,
  from?: string,
  fits?: (listed: FindResult) => boolean,
): Promise<FindResult> {
  const items: FindItem[] = [];
  let first: FindResult | undefined;
  let cursor = from;
  for (let pages = 0; pages < MAX_DATA_PAGES; pages += 1) {
    const page = await listingPage(pack, summary, cursor, FIND_MAX_LIMIT);
    // The totals are the first page's to say: a page read from a cursor counts what it lists.
    first ??= from === undefined ? page : { ...page, totals: undefined };
    const head = first;
    const listed = (more: readonly FindItem[], nextCursor: string | undefined): FindResult => ({
      ...head,
      items: [...items, ...more],
      nextCursor,
    });
    const whole = listed(page.items, page.nextCursor);
    if (fits !== undefined && !fits(whole)) {
      // Counted with the cursor this page gave: one for fewer results is as long.
      const ended = page.nextCursor ?? cursor ?? "";
      let count = page.items.length - 1;
      while (count > 0 && !fits(listed(page.items.slice(0, count), ended))) {
        count -= 1;
      }
      if (count === 0 && items.length > 0) {
        return listed([], cursor);
      }
      const fewer = await listingPage(pack, summary, cursor, Math.max(1, count));
      return listed(fewer.items, fewer.nextCursor);
    }
    items.push(...page.items);
    if (page.nextCursor === undefined) {
      return whole;
    }
    // A pack that answers the page it was just asked for again would be read without end.
    if (page.nextCursor === cursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The pack answers more pages of its listing than one read takes.",
  );
}

/**
 * A page of entries as far as one read prints it (ADR-0124): the page asked for, or the same
 * page asked for again with as many entries as the bound takes at the length these have, which
 * the pack ends with the cursor of the entry it left out. A page of one entry is printed as it
 * is, and so is one a pack does not shorten when asked for fewer.
 */
async function pageWithin<T>(
  bound: number,
  limit: number | undefined,
  ask: (limit: number | undefined) => Promise<T>,
  print: (page: T) => { readonly text: string; readonly count: number },
): Promise<{ readonly page: T; readonly text: string }> {
  let asked = limit;
  let before = Number.POSITIVE_INFINITY;
  for (;;) {
    const page = await ask(asked);
    const { text, count } = print(page);
    if (utf8Length(text) <= bound || count <= 1 || count >= before) {
      return { page, text };
    }
    before = count;
    asked = Math.max(1, Math.min(count - 1, Math.floor((count * bound) / utf8Length(text))));
  }
}

/**
 * What a read says when a skill is not at a path: the exact paths that are, and the manifests
 * that could not be read, since the skill asked for may be among them.
 */
async function notFound(
  pack: Pack,
  summary: MountSummary,
  path: string,
  words: ToolWords,
): Promise<PackError> {
  let available: string[] = [];
  let diagnostics = "";
  try {
    const listed = await listing(pack, summary);
    available = listed.items.flatMap((item) =>
      item.kind === "skill" && item.path !== undefined ? [item.path] : [],
    );
    diagnostics = renderDiagnostics(listed.diagnostics, true, undefined, words) ?? "";
  } catch {
    // The list is a courtesy: the refusal stands without it.
  }
  return new PackError(
    404,
    "skill.not_found",
    `No skill at ${JSON.stringify(path)}. Use ${words.browse} or ${words.search} for its exact SKILL.md path.${available.length === 0 ? "" : ` Available: ${available.slice(0, 20).join(", ")}.`}${diagnostics.length === 0 ? "" : `\n${diagnostics}`}`,
  );
}

/**
 * A skill from `from` on, every page of its context joined, or as many of them as print within
 * `fits` where it is given (ADR-0108): the first page whatever its length, and then each that
 * keeps the part within it. A part that stops before the skill does ends incomplete, with the
 * cursor of the page it did not take.
 */
async function skillFrom(
  pack: Pack,
  summary: MountSummary,
  path: string,
  from: string | undefined,
  words: ToolWords,
  fits?: (part: SkillResult) => boolean,
): Promise<SkillResult> {
  const pages: SkillResult[] = [];
  let cursor = from;
  for (let read = 0; read < MAX_SKILL_PAGES; read += 1) {
    const body = await pack.skill(path, cursor).catch(async (error: unknown) => {
      if (error instanceof PackError && error.code === "skill.not_found") {
        throw await notFound(pack, summary, path, words);
      }
      throw error;
    });
    if (body.status !== "ready") {
      throw notReady(body.status);
    }
    const page = skillResultOf(body, summary);
    if (page === undefined) {
      throw new PackError(
        0,
        "invalid_response",
        "The pack answered a skill in an unexpected shape.",
      );
    }
    const joined = joinSkillPages([...pages, page]);
    if (joined === undefined) {
      throw new Error("a skill has at least one page");
    }
    if (fits !== undefined && pages.length > 0 && !fits(joined)) {
      const part = joinSkillPages(pages);
      if (part === undefined) {
        throw new Error("a part has at least one page");
      }
      return part;
    }
    pages.push(page);
    if (page.complete || page.nextCursor === undefined) {
      return joined;
    }
    // A pack that answers the page it was just asked for again would be read without end.
    if (page.nextCursor === cursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The skill did not complete within the pages one read takes.",
  );
}

/**
 * A part as it is printed (ADR-0113, ADR-0124): what one answer shows of a page of a skill
 * (`skillShown`), as a page over MCP is shown. One read from a cursor says the facts of the skill
 * no second time, and one that reaches the end of the skill is its last part, which it says; a
 * skill printed whole from its start is not one read in parts, and says nothing of them.
 */
function printed(part: SkillResult, continued: boolean): SkillResult {
  return skillShown(continued && part.complete ? { ...part, pagesLeft: 0 } : part, continued);
}

/** The first `end` characters of a page of a file, as a page: the next begins where it ends, and it lists the links within it. */
function cutAt(result: FileResult, end: number): FileResult {
  const content = result.content.slice(0, end);
  const { packReferences, ...page } = result;
  const linked = packReferences?.filter((reference) => content.includes(reference.href)) ?? [];
  return {
    ...page,
    content,
    nextOffset: result.offset + end,
    references: result.references?.filter((reference) => content.includes(reference.href)),
    ...(linked.length === 0 ? {} : { packReferences: linked }),
  };
}

/**
 * A page of a file the read cut where no length was asked (ADR-0108), ended at the end of its
 * last whole line, as the reader ends a page it cuts; the next page starts after that line.
 */
function endAtLine(result: FileResult): FileResult {
  if (result.nextOffset === undefined) {
    return result;
  }
  const end = result.content.lastIndexOf("\n") + 1;
  return end === 0 || end === result.content.length ? result : cutAt(result, end);
}

/**
 * A page of a file as far as one read prints it (ADR-0124): the page the pack gave where it
 * prints within the bound, a length that was asked for among them, else as much of it from its
 * start as does, ended after its last whole line. A line longer than one read prints is cut where
 * the bytes run out, between two characters.
 */
function fileWithin(
  bound: number,
  result: FileResult,
  print: (page: FileResult) => string,
): FileResult {
  if (utf8Length(print(result)) <= bound) {
    return result;
  }
  // What the page takes beside its text, counted without the text: the header, and no link yet.
  let room = bound - utf8Length(print(cutAt(result, 0)));
  for (;;) {
    const piece = contextPage(result.content, 0, Math.max(0, room)).content;
    const line = piece.lastIndexOf("\n") + 1;
    const page = cutAt(result, line === 0 ? piece.length : line);
    // The links within the page are listed after it, and are counted with it.
    const over = utf8Length(print(page)) - bound;
    if (over <= 0 || page.content.length === 0) {
      return page;
    }
    room -= over;
  }
}

/** Every page of the tables under a path, joined. */
async function allRows(pack: Pack, query: DataQuery): Promise<RowsPage> {
  let joined: RowsPage | undefined;
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_DATA_PAGES; pages += 1) {
    const page = await pack.rows({ ...query, cursor, limit: DATA_ROWS_MAX_LIMIT });
    joined =
      joined === undefined
        ? page
        : {
            ...joined,
            tables: [...joined.tables, ...page.tables],
            rowCount: joined.rowCount + page.rowCount,
            nextCursor: page.nextCursor,
          };
    if (page.nextCursor === null) {
      return joined;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The pack answers more pages of tables than one read takes.",
  );
}

/** Every page of the code blocks under a path, joined. */
async function allCode(pack: Pack, query: DataQuery): Promise<CodePage> {
  let joined: CodePage | undefined;
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_DATA_PAGES; pages += 1) {
    const page = await pack.code({ ...query, cursor, limit: DATA_CODE_MAX_LIMIT });
    joined =
      joined === undefined
        ? page
        : { ...joined, blocks: [...joined.blocks, ...page.blocks], nextCursor: page.nextCursor };
    if (page.nextCursor === null) {
      return joined;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The pack answers more pages of code than one read takes.",
  );
}

const asJson = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * Reads `pack` as the command does and says what it prints (ADR-0110): the words an agent is
 * given, or with `json` the API's JSON; for the data reads the text to print or to write to a
 * file, and what it holds. A read the pack refuses, or cannot answer, throws a PackError; one
 * that was not asked right, a ReadMisuse.
 */
export async function readPack(
  pack: Pack,
  read: PackRead,
  options: ReadOptions = {},
): Promise<ReadOutput> {
  const words = options.words ?? COMMAND_WORDS;
  const json = options.json === true;
  // What one read prints for an agent, in bytes, less what the caller prints beside it: every
  // read below is made to fit it (ADR-0124).
  const bound = COMMAND_OUTPUT_MAX_BYTES - Math.max(0, options.room ?? 0);
  const fits = (text: string): boolean => utf8Length(text) <= bound;
  // The mount is asked for by the reads that print from it: where the pack is and at which
  // commit, for the text an agent is given. The API's JSON and the data reads need none of it.
  const summarized = async (): Promise<MountSummary> => mountSummaryOf(await pack.mount());
  switch (read.read) {
    case "skills": {
      const mount = await pack.mount();
      if (json) {
        return { text: asJson(mount) };
      }
      // What a client is told on connect is said once, above the first page of the listing; a
      // page read from a cursor says that it goes on from the one before.
      const continued = read.cursor !== undefined;
      const above = continued
        ? "Continued from the page before. This page lists:\n"
        : `${renderInstructions(catalogStateOf(mount), words)}\n\n`;
      // A listing longer than one read prints is printed in pages where the caller says how to
      // read on (`nextPart`), and each page ends with that command. A caller that gives none has
      // no way on from a page, so it is given the listing whole, as before: what a page would
      // leave out would be lost for certain, and a host loses only what is past its bound.
      const goesOn = options.nextPart;
      const print = (listed: FindResult): string =>
        `${above}${renderFindResult(listed, words)}${
          listed.nextCursor === undefined
            ? continued
              ? "\n\nThe listing is complete: this was its last page."
              : ""
            : goesOn === undefined
              ? ""
              : `\n\nThe listing goes on: ${goesOn(listed.nextCursor)}`
        }`;
      const listed = await listing(
        pack,
        mountSummaryOf(mount),
        read.cursor,
        goesOn === undefined ? undefined : (candidate) => fits(print(candidate)),
      );
      return {
        text: print(listed),
        ...(listed.nextCursor === undefined ? {} : { next: { cursor: listed.nextCursor } }),
      };
    }
    case "browse": {
      const limit = readNumber(read.limit, "limit", BROWSE_MAX_LIMIT);
      const summary = json ? undefined : await summarized();
      const ask = async (count: number | undefined): Promise<ReadyBrowse> => {
        const body = await pack.browse({ path: read.path, cursor: read.cursor, limit: count });
        if (body.status !== "ready") {
          throw notReady(body.status);
        }
        return body;
      };
      if (summary === undefined) {
        return { text: asJson(await ask(limit)) };
      }
      const resultOf = (body: ReadyBrowse): BrowseResult => {
        const result = browseResultOf(body, summary);
        if (result === undefined) {
          throw new PackError(
            0,
            "invalid_response",
            "The pack answered a folder in an unexpected shape.",
          );
        }
        return result;
      };
      // A page of a folder is its entries, and a page of an outline its headings.
      const { page, text } = await pageWithin(bound, limit, ask, (body) => {
        const result = resultOf(body);
        return {
          text: renderBrowseResult(result, words),
          count: result.outline?.headings.length ?? result.entries.length,
        };
      });
      const { nextCursor } = resultOf(page);
      return { text, ...(nextCursor === undefined ? {} : { next: { cursor: nextCursor } }) };
    }
    case "find": {
      const query = read.words.trim();
      if (query.length === 0) {
        throw new ReadMisuse("Say the words to find.");
      }
      const limit = readNumber(read.limit, "limit", FIND_MAX_LIMIT);
      const summary = json ? undefined : await summarized();
      const ask = async (count: number | undefined): Promise<ReadyFind> => {
        const body = await pack.find({ query, path: read.path, cursor: read.cursor, limit: count });
        if (body.status !== "ready") {
          throw notReady(body.status);
        }
        return body;
      };
      if (summary === undefined) {
        return { text: asJson(await ask(limit)) };
      }
      const { page, text } = await pageWithin(bound, limit, ask, (body) => {
        const result = findResultOf(body, summary);
        return { text: renderFindResult(result, words), count: result.items.length };
      });
      const { nextCursor } = findResultOf(page, summary);
      return { text, ...(nextCursor === undefined ? {} : { next: { cursor: nextCursor } }) };
    }
    case "skill": {
      const summary = await summarized();
      if (json) {
        const whole = await skillFrom(pack, summary, read.path, read.cursor, words);
        const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill: whole } });
        return { text: asJson("body" in outcome ? outcome.body : outcome.failure) };
      }
      // A part says how many pages follow it, and the command that prints the next at its head
      // and as its last line (ADR-0124); a section the part cuts continues in the next part, in
      // the caller's word for one or ours.
      const nextPart =
        options.nextPart ??
        ((cursor: string) => `${words.load} ${shellWord(read.path)} --cursor ${shellWord(cursor)}`);
      // The skill's own folder is named by the command that lists it, and not by the call of a
      // tool, which a reader of a command cannot run.
      const browseFolder =
        options.browseFolder ??
        ((path: string) =>
          path.length === 0 ? words.browse : `${words.browse} ${shellWord(path)}`);
      const said: ToolWords = {
        ...words,
        piece: words.piece ?? "part",
        loadNext: words.loadNext ?? ((_path, cursor) => nextPart(cursor)),
        browseFolder: words.browseFolder ?? browseFolder,
      };
      const continued = read.cursor !== undefined;
      const render = (part: SkillResult): string =>
        renderSkillResult(printed(part, continued), said);
      const part = await skillFrom(pack, summary, read.path, read.cursor, words, (candidate) =>
        fits(render(candidate)),
      );
      return {
        text: render(part),
        ...(part.complete || part.nextCursor === undefined
          ? {}
          : { next: { cursor: part.nextCursor, pagesLeft: part.pagesLeft } }),
      };
    }
    case "file": {
      const asked = readNumber(read.limit, "limit", READ_FILE_MAX_LIMIT);
      // A page for an agent stays within what its host shows whole; the JSON is the API's page.
      // The pack is asked in characters, as a file is addressed, and the bound is in bytes.
      const limit = asked ?? (json ? undefined : FILE_PAGE_CHARS);
      const offset = readNumber(read.offset, "offset", Number.MAX_SAFE_INTEGER);
      const summary = json ? undefined : await summarized();
      const body = await pack.file({ path: read.path, offset, limit });
      if (summary === undefined) {
        return { text: asJson(body) };
      }
      if (body.kind === "directory") {
        const result = directoryResultOf(body, summary);
        if (result === undefined) {
          throw new PackError(
            0,
            "invalid_response",
            "The pack answered a folder in an unexpected shape.",
          );
        }
        return { text: renderDirectoryResult(result) };
      }
      const result = fileResultOf(body, summary);
      if (result === undefined) {
        throw new PackError(
          0,
          "invalid_response",
          "The pack answered a file in an unexpected shape.",
        );
      }
      // The length asked for travels with the result, so that a range the read got in full says
      // where the file continues, as a tool result does; the body itself does not carry it. A
      // page the read cut, for the length it asks by itself or for the bound, ends at a line and
      // says to read on.
      const print = (page: FileResult): string => renderFileResult(fileShown(page), words);
      const page = fileWithin(
        bound,
        asked === undefined ? endAtLine(result) : { ...result, requestedLength: asked },
        print,
      );
      return {
        text: print(page),
        ...(page.nextOffset === undefined ? {} : { next: { offset: page.nextOffset } }),
      };
    }
    case "rows": {
      const format = read.format ?? "csv";
      if (format !== "csv" && format !== "json") {
        throw new ReadMisuse("--format takes csv or json.");
      }
      const body = await allRows(pack, { path: read.path, heading: read.heading });
      const holds = `${counted(body.rowCount, "row")} of ${counted(body.tables.length, "table")}`;
      if (json) {
        return { text: asJson(body), holds };
      }
      if (format === "json") {
        const rows = body.tables.flatMap((table) =>
          table.rows.map((row) => ({
            path: table.path,
            heading: table.heading.join(" > "),
            // In the order of the columns; a name a table has twice keeps its first cell.
            cells: table.columns.reduce<Record<string, string>>((cells, column, at) => {
              if (!Object.hasOwn(cells, column)) {
                cells[column] = row[at] ?? "";
              }
              return cells;
            }, {}),
          })),
        );
        return { text: asJson(rows), holds };
      }
      return { text: rowsCsv(body.tables), holds };
    }
    case "code": {
      let pattern: RegExp | undefined;
      if (read.grep !== undefined) {
        try {
          pattern = new RegExp(read.grep, "u");
        } catch (error) {
          throw new ReadMisuse(
            `--grep takes a regular expression: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const all = await allCode(pack, { path: read.path, heading: read.heading });
      const kept =
        pattern === undefined ? all.blocks : all.blocks.filter((block) => pattern.test(block.text));
      const holds = counted(kept.length, "code block");
      if (json) {
        return { text: asJson({ ...all, blocks: kept }), holds };
      }
      const text = kept
        .map(
          (block) =>
            `--- ${block.path}${block.heading.length === 0 ? "" : ` > ${block.heading.join(" > ")}`}${block.language.length === 0 ? "" : ` (${block.language})`} ---\n${block.text}\n`,
        )
        .join("\n");
      return { text, holds };
    }
  }
}
