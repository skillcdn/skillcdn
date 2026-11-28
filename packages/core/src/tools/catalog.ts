import type { MountSearch } from "../ports/index-store.js";
import type { RepoPath } from "../repo-path.js";
import { searchTool } from "./contracts.js";
import { describeMount, MCP_TOOL_WORDS, plural, type ToolWords } from "./render.js";
import { compactSummary } from "./response-budget.js";
import type { BrowseEntry, FolderOverview, IndexDiagnostic, MountSummary } from "./results.js";

export interface CatalogSkill {
  readonly name: string;
  readonly directory: RepoPath;
  readonly description: string;
}
export interface CatalogManifest {
  readonly name: string | undefined;
  readonly description: string;
  readonly path: RepoPath | undefined;
  /** Whether the manifest has a body of rules; unknown to a catalog made from the REST API. */
  readonly hasRules?: boolean;
  /** The page the pack tells an agent to read before a task, inside the mount (ADR-0119). */
  readonly start?: RepoPath | undefined;
  readonly language: string | undefined;
}
export interface MountCatalog {
  readonly overview?: FolderOverview;
  /** Repository description supplied by its git host, used only as a fallback. */
  readonly description?: string;
  readonly groups?: readonly BrowseEntry[];
  /**
   * How many entries of the mounted folder hold a skill or a document, where `groups` may be
   * only the first of its entries: the instructions say how many they do not list (ADR-0112).
   */
  readonly groupCount?: number;
  readonly mount: MountSummary;
  readonly manifest: CatalogManifest | undefined;
  readonly skills: readonly CatalogSkill[];
  readonly skillCount: number;
  readonly documentCount: number;
  readonly diagnostics: readonly IndexDiagnostic[];
  /** How the mount is searched (ADR-0064); left out where the words answer alone and nothing is to say. */
  readonly search?: MountSearch | undefined;
}
export type CatalogState =
  | { readonly status: "ready"; readonly catalog: MountCatalog }
  | {
      readonly status: "indexing" | "failed";
      readonly mount: MountSummary;
      readonly description?: string;
    };
export const INSTRUCTIONS_MAX_LENGTH = 2000;
export const FIND_DESCRIPTION_MAX_LENGTH = 800;
/**
 * How the reads work, in one line each. The search's line says what it matches, so that an agent
 * asks in the pack's own words where only words match, and in its own where meaning does too
 * (ADR-0064).
 */
const howTo = (words: ToolWords, meaning: boolean): string =>
  `${words.browse} explores folders and outlines a file by its headings; ${words.search} ${meaning ? "matches words and meaning, so ask in your own words; it names the sections that matched" : "matches original words (usually English) and names the sections that matched"}. ${words.load} loads an exact SKILL.md path; ${words.piece === undefined ? "follow nextCursor until complete before applying it" : `a long skill comes in ${words.piece}s, each ending with the command that prints the next: read every ${words.piece} before applying it`}. ${words.read} reads optional references, or one section by its offset and limit. Paths start at the repository root and stay inside the mount.`;

/** Where the same skills are for a host that implements the MCP skills extension (ADR-0024). */
function extensionLine(mount: MountSummary): string {
  return `Skills are also served through the MCP skills extension as ${mount.skillUri}/<path>.`;
}

/** Explicit author metadata wins; a README and host description make manifests optional. */
export function catalogDescription(catalog: MountCatalog): string | undefined {
  return catalog.manifest?.description || catalog.overview?.description || catalog.description;
}

/**
 * The one sentence a connection is told while another commit's index is served (ADR-0068): once,
 * here, so that no result has to say it. The clause in every `Source` line names the commits.
 */
function newestSentence(mount: MountSummary): string {
  const newest = mount.newest;
  if (newest === undefined) return "";
  const failure = newest.status === "failed" ? ` (${newest.errorCode ?? "unknown"})` : "";
  if (newest.commit === mount.commit) {
    return newest.status === "indexing"
      ? " The index of this commit is being rebuilt under newer reading rules; until it is, what is served is its index under the rules before."
      : ` Rebuilding the index of this commit under newer reading rules failed${failure} and is retried; what is served is its index under the rules before.`;
  }
  return newest.status === "indexing"
    ? ` The newest commit of this ref, ${newest.commit.slice(0, 7)}, is being indexed; until it is ready, what is served is the last indexed commit, ${mount.commit.slice(0, 7)}.`
    : ` The newest commit of this ref, ${newest.commit.slice(0, 7)}, could not be indexed${failure} and is retried; what is served is the last indexed commit, ${mount.commit.slice(0, 7)}.`;
}

/**
 * Whether a connection is told of an entry: one with nothing discoverable (hidden copies of a
 * skill, test fixtures, code) stays browsable, and takes none of the room.
 */
export const holdsSomething = (entry: BrowseEntry): boolean =>
  entry.skillCount > 0 || entry.documentCount > 0;

/**
 * The entries of a mounted folder as a catalog takes them: the first of those a connection is told
 * of, and how many of those there are.
 */
export function catalogGroups(
  entries: readonly BrowseEntry[],
  limit: number,
): { readonly groups: readonly BrowseEntry[]; readonly groupCount: number } {
  const told = entries.filter(holdsSomething);
  return { groups: told.slice(0, limit), groupCount: told.length };
}

/** A row of the overview: what it has to say, and what it says while there is room for it. */
interface OverviewRow {
  readonly kind: "folder" | "skill" | "file";
  /** The path as a read takes it, a folder's with its closing slash. */
  readonly head: string;
  readonly name: string;
  readonly description: string;
  /** How long a description is at most, with all the room there is. */
  readonly descriptionLength: number;
  /** What a folder holds; empty for a skill. */
  readonly counts: string;
}
const ROW_NAME_LENGTH = 80;
const FOLDER_DESCRIPTION_LENGTH = 100;
const SKILL_DESCRIPTION_LENGTH = 90;
/** Shorter than this, a description or a name is a stub that says nothing: it is left out. */
const ROW_DESCRIPTION_FLOOR = 24;
const ROW_NAME_FLOOR = 16;

function rowText(row: OverviewRow, nameLength: number, descriptionLength: number): string {
  const name = compactSummary(row.name, Math.min(nameLength, ROW_NAME_LENGTH));
  const description = compactSummary(
    row.description,
    Math.min(descriptionLength, row.descriptionLength),
  );
  const said = [name === "" ? "" : `${name}.`, description, row.counts]
    .filter((part) => part !== "")
    .join(" ");
  return said === "" ? row.head : `${row.head}: ${said}`;
}

/** The greatest value from `low` to `high` that `fits`, where whatever fits below a value that fits. */
function greatest(low: number, high: number, fits: (value: number) => boolean): number | undefined {
  if (!fits(low)) return undefined;
  let [least, most] = [low, high];
  while (least < most) {
    const middle = Math.ceil((least + most) / 2);
    if (fits(middle)) least = middle;
    else most = middle - 1;
  }
  return least;
}

/** The line that says rows are left out: what they are is told by the rows there are. */
function leftOutLine(rows: readonly OverviewRow[], left: number, listed: number): string {
  const kinds = new Set(rows.map((row) => row.kind));
  const [first] = kinds;
  const noun =
    first === undefined ? "folder" : kinds.size === 1 && first !== "file" ? first : "entry";
  const many = noun === "entry" ? "entries" : `${noun}s`;
  return `${left} ${listed === 0 ? "" : "more "}${left === 1 ? `${noun} is` : `${many} are`} not listed here.`;
}

/**
 * The rows in the room they are given, a row costing its characters and its line end (ADR-0112).
 * Every row is kept while it fits by saying less: the descriptions are cut alike, then left out,
 * then the names. Only rows whose path and counts alone do not fit are left out, and a line says
 * how many, with the `beyond` that the catalog counts and has no row for.
 */
function fitRows(
  rows: readonly OverviewRow[],
  beyond: number,
  room: number,
): { readonly lines: readonly string[]; readonly listed: number; readonly shortened: boolean } {
  // The line is reserved at its longest: every row left out, after one that was not.
  const closing = leftOutLine(rows, rows.length + beyond, 1).length + 1;
  const whole = beyond === 0 ? room : room - closing;
  const cost = (nameLength: number, descriptionLength: number): number =>
    rows.reduce((sum, row) => sum + rowText(row, nameLength, descriptionLength).length + 1, 0);
  const all = (nameLength: number, descriptionLength: number, shortened: boolean) => ({
    lines: [
      ...rows.map((row) => rowText(row, nameLength, descriptionLength)),
      ...(beyond === 0 ? [] : [leftOutLine(rows, beyond, rows.length)]),
    ],
    listed: rows.length,
    shortened,
  });
  if (cost(ROW_NAME_LENGTH, FOLDER_DESCRIPTION_LENGTH) <= whole) {
    return all(ROW_NAME_LENGTH, FOLDER_DESCRIPTION_LENGTH, false);
  }
  const description = greatest(
    ROW_DESCRIPTION_FLOOR,
    FOLDER_DESCRIPTION_LENGTH - 1,
    (length) => cost(ROW_NAME_LENGTH, length) <= whole,
  );
  if (description !== undefined) return all(ROW_NAME_LENGTH, description, true);
  const name = greatest(ROW_NAME_FLOOR, ROW_NAME_LENGTH, (length) => cost(length, 0) <= whole);
  if (name !== undefined) return all(name, 0, true);
  if (cost(0, 0) <= whole) return all(0, 0, true);
  let left = room - closing;
  const lines: string[] = [];
  for (const row of rows) {
    const line = rowText(row, 0, 0);
    if (line.length + 1 > left) continue;
    lines.push(line);
    left -= line.length + 1;
  }
  const listed = lines.length;
  if (closing <= room) lines.push(leftOutLine(rows, rows.length + beyond - listed, listed));
  return { lines, listed, shortened: true };
}

/** The instructions of a connection, and what became of the overview's rows in their room. */
export interface InstructionsFit {
  readonly text: string;
  /** The folders and skills the catalog counts a row for. */
  readonly rows: number;
  /** How many of them the text names: fewer than `rows` where not even their paths fit. */
  readonly listed: number;
  /** Whether the rows say less than they do with room: a shorter description or name, or none. */
  readonly shortened: boolean;
}

/** A bounded introduction; complete discovery always remains available through the browse read. */
export function renderInstructions(state: CatalogState, words: ToolWords = MCP_TOOL_WORDS): string {
  return fitInstructions(state, words).text;
}

/** `renderInstructions`, with what the bound cost the overview: `skillcdn check` says it. */
export function fitInstructions(
  state: CatalogState,
  words: ToolWords = MCP_TOOL_WORDS,
): InstructionsFit {
  const mount = state.status === "ready" ? state.catalog.mount : state.mount;
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  const title =
    manifest?.name ?? (state.status === "ready" ? state.catalog.overview?.title : undefined);
  const description =
    state.status === "ready" ? catalogDescription(state.catalog) : state.description;
  const head = `Skills and documents from ${describeMount(mount)}.${description === undefined ? "" : ` ${compactSummary(title ?? mount.repository, 120)}: ${compactSummary(description, 240)}`}`;
  if (state.status !== "ready")
    return {
      text: `${head} ${state.status === "indexing" ? "The commit is being indexed" : "The commit could not be indexed"}; retry ${words.browse} shortly. ${howTo(words, false)}`.slice(
        0,
        INSTRUCTIONS_MAX_LENGTH,
      ),
      rows: 0,
      listed: 0,
      shortened: false,
    };
  const catalog = state.catalog;
  const language =
    manifest?.language === undefined
      ? ""
      : ` Written in ${manifest.language}; child folders may declare another language.`;
  const diagnostics =
    catalog.diagnostics.length === 0
      ? ""
      : ` ${catalog.diagnostics.length} index issues reported (${catalog.diagnostics
          .slice(0, 3)
          .map((item) => compactSummary(item.path, 80))
          .join(", ")}); ${words.browse} reports diagnostics.`;
  const summary = `${head}${newestSentence(mount)} ${plural(catalog.skillCount, "skill")}, ${plural(catalog.documentCount, "document")}.${language}${diagnostics}`;
  const skillRow = (skill: CatalogSkill): OverviewRow => ({
    kind: "skill",
    head: `${skill.directory ? `${skill.directory}/` : ""}SKILL.md`,
    name: "",
    description: skill.description,
    descriptionLength: SKILL_DESCRIPTION_LENGTH,
    counts: "",
  });
  // A folder is introduced by what can be discovered in it.
  const groupRow = (entry: BrowseEntry): OverviewRow => ({
    kind: entry.kind === "directory" ? "folder" : entry.kind,
    head: `${entry.path}${entry.kind === "directory" ? "/" : ""}`,
    name: entry.name ?? "",
    description: entry.description ?? "",
    descriptionLength: FOLDER_DESCRIPTION_LENGTH,
    counts: [
      entry.skillCount === 0 ? undefined : plural(entry.skillCount, "skill"),
      entry.documentCount === 0 ? undefined : plural(entry.documentCount, "document"),
    ]
      .filter((count) => count !== undefined)
      .join(", "),
  });
  const discoverable = (catalog.groups ?? []).filter(holdsSomething);
  const rows =
    catalog.groups === undefined
      ? catalog.skills.map(skillRow)
      : [
          // A skill at the mounted directory itself belongs to no folder: it is introduced by name.
          ...catalog.skills.filter((skill) => skill.directory.length === 0).map(skillRow),
          ...discoverable.map(groupRow),
        ];
  const ending = `${words.browse} returns the full folder contents with continuation.\n${howTo(words, catalog.search?.meaning === true)}\n${extensionLine(mount)}`;
  let result = `${compactSummary(summary, INSTRUCTIONS_MAX_LENGTH - ending.length - 1)}\n`;
  // The manifest is not an entry of any folder: a model that is told to read the pack's
  // metadata, its conversion date for one, is told here where it is.
  // A pack that names where an agent starts is told of that page in the place of the README,
  // which is written for the people who open the repository (ADR-0119).
  const lines = [
    manifest?.start !== undefined
      ? `Start here, before a task: ${words.read} ${manifest.start}.`
      : catalog.overview === undefined
        ? undefined
        : `Optional overview: ${words.read} ${catalog.overview.path}.`,
    manifest?.path === undefined
      ? undefined
      : `Manifest: ${words.read} ${manifest.path} for the pack's metadata and rules.`,
  ];
  for (const line of lines) {
    if (
      line !== undefined &&
      result.length + line.length + ending.length + 1 <= INSTRUCTIONS_MAX_LENGTH
    ) {
      result += `${line}\n`;
    }
  }
  // What the catalog counts beyond the entries it was given: the folder's own listing has them.
  const beyond =
    catalog.groups === undefined || catalog.groupCount === undefined
      ? 0
      : Math.max(0, catalog.groupCount - discoverable.length);
  const fit = fitRows(rows, beyond, INSTRUCTIONS_MAX_LENGTH - result.length - ending.length);
  for (const line of fit.lines) result += `${line}\n`;
  return {
    text: `${result}${ending}`,
    rows: rows.length + beyond,
    listed: fit.listed,
    shortened: fit.shortened,
  };
}

/** Short tool description for clients that do not expose server instructions. */
export function describeFindTool(state: CatalogState): string {
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  const description =
    state.status === "ready" ? catalogDescription(state.catalog) : state.description;
  const about = description === undefined ? "" : ` ${compactSummary(description, 180)}`;
  return `${searchTool.description}${about}${manifest?.language === undefined ? "" : ` Written in ${manifest.language}.`}`.slice(
    0,
    FIND_DESCRIPTION_MAX_LENGTH,
  );
}
