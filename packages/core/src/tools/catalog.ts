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
  readonly language: string | undefined;
}
export interface MountCatalog {
  readonly overview?: FolderOverview;
  /** Repository description supplied by its git host, used only as a fallback. */
  readonly description?: string;
  readonly groups?: readonly BrowseEntry[];
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
  `${words.browse} explores folders and outlines a file by its headings; ${words.search} ${meaning ? "matches words and meaning, so ask in your own words; it names the sections that matched" : "matches original words (usually English) and names the sections that matched"}. ${words.load} loads an exact SKILL.md path; follow nextCursor until complete before applying it. ${words.read} reads optional references, or one section by its offset and limit. Paths start at the repository root and stay inside the mount.`;

/** Where the same skills are for a host that implements the MCP skills extension (ADR-0024). */
function extensionLine(mount: MountSummary): string {
  return `Skills are also served through the MCP skills extension as ${mount.skillUri}/<path>.`;
}

/** Explicit author metadata wins; a README and host description make manifests optional. */
export function catalogDescription(catalog: MountCatalog): string | undefined {
  return catalog.manifest?.description || catalog.overview?.description || catalog.description;
}

/** A bounded introduction; complete discovery always remains available through the browse read. */
export function renderInstructions(state: CatalogState, words: ToolWords = MCP_TOOL_WORDS): string {
  const mount = state.status === "ready" ? state.catalog.mount : state.mount;
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  const title =
    manifest?.name ?? (state.status === "ready" ? state.catalog.overview?.title : undefined);
  const description =
    state.status === "ready" ? catalogDescription(state.catalog) : state.description;
  const head = `Skills and documents from ${describeMount(mount)}.${description === undefined ? "" : ` ${compactSummary(title ?? mount.repository, 120)}: ${compactSummary(description, 240)}`}`;
  if (state.status !== "ready")
    return `${head} ${state.status === "indexing" ? "The commit is being indexed" : "The commit could not be indexed"}; retry ${words.browse} shortly. ${howTo(words, false)}`.slice(
      0,
      INSTRUCTIONS_MAX_LENGTH,
    );
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
  const summary = `${head} ${plural(catalog.skillCount, "skill")}, ${plural(catalog.documentCount, "document")}.${language}${diagnostics}`;
  const skillRow = (skill: CatalogSkill): string =>
    `${skill.directory ? `${skill.directory}/` : ""}SKILL.md: ${compactSummary(skill.description, 90)}`;
  // A folder is introduced by what can be discovered in it. One with nothing discoverable (hidden
  // copies of a skill, test fixtures, code) stays browsable, but does not take up the budget.
  const groupRow = (entry: BrowseEntry): string => {
    const counts = [
      entry.skillCount === 0 ? undefined : plural(entry.skillCount, "skill"),
      entry.documentCount === 0 ? undefined : plural(entry.documentCount, "document"),
    ].filter((count) => count !== undefined);
    return `${entry.path}${entry.kind === "directory" ? "/" : ""}: ${entry.name === null ? "" : `${compactSummary(entry.name, 80)}. `}${entry.description === null ? "" : `${compactSummary(entry.description, 100)} `}${counts.join(", ")}`;
  };
  const rows =
    catalog.groups === undefined
      ? catalog.skills.map(skillRow)
      : [
          // A skill at the mounted directory itself belongs to no folder: it is introduced by name.
          ...catalog.skills.filter((skill) => skill.directory.length === 0).map(skillRow),
          ...catalog.groups
            .filter((entry) => entry.skillCount > 0 || entry.documentCount > 0)
            .map(groupRow),
        ];
  const ending = `${words.browse} returns the full folder contents with continuation.\n${howTo(words, catalog.search?.meaning === true)}\n${extensionLine(mount)}`;
  let result = `${compactSummary(summary, INSTRUCTIONS_MAX_LENGTH - ending.length - 1)}\n`;
  const overview =
    catalog.overview === undefined
      ? undefined
      : `Optional overview: ${words.read} ${catalog.overview.path}.`;
  if (
    overview !== undefined &&
    result.length + overview.length + ending.length + 1 <= INSTRUCTIONS_MAX_LENGTH
  ) {
    result += `${overview}\n`;
  }
  for (const row of rows) {
    if (result.length + row.length + ending.length + 1 > INSTRUCTIONS_MAX_LENGTH) break;
    result += `${row}\n`;
  }
  return `${result}${ending}`;
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
