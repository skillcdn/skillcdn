import type { RepoPath } from "../repo-path.js";
import { searchTool } from "./contracts.js";
import { describeMount, plural } from "./render.js";
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
  readonly hasRules: boolean;
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
const HOW_TO =
  "browse explores folders; search matches original words (usually English). get_skill loads an exact SKILL.md path; follow nextCursor until complete before applying it. read_file reads optional references. Paths start at the repository root and stay inside the mount.";

/** Explicit author metadata wins; a README and host description make manifests optional. */
export function catalogDescription(catalog: MountCatalog): string | undefined {
  return catalog.manifest?.description || catalog.overview?.description || catalog.description;
}

/** A bounded introduction; complete discovery always remains available through browse. */
export function renderInstructions(state: CatalogState): string {
  const mount = state.status === "ready" ? state.catalog.mount : state.mount;
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  const title =
    manifest?.name ?? (state.status === "ready" ? state.catalog.overview?.title : undefined);
  const description =
    state.status === "ready" ? catalogDescription(state.catalog) : state.description;
  const head = `Skills and documents from ${describeMount(mount)}.${description === undefined ? "" : ` ${compactSummary(title ?? mount.repository, 120)}: ${compactSummary(description, 240)}`}`;
  if (state.status !== "ready")
    return `${head} ${state.status === "indexing" ? "The commit is being indexed" : "The commit could not be indexed"}; retry browse shortly. ${HOW_TO}`.slice(
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
          .join(", ")}); browse reports diagnostics.`;
  const summary = `${head} ${plural(catalog.skillCount, "skill")}, ${plural(catalog.documentCount, "document")}.${language}${diagnostics}`;
  const rows =
    catalog.groups === undefined
      ? catalog.skills.map(
          (skill) =>
            `${skill.directory ? `${skill.directory}/` : ""}SKILL.md: ${compactSummary(skill.description, 90)}`,
        )
      : catalog.groups.map(
          (entry) =>
            `${entry.path}${entry.kind === "directory" ? "/" : ""}: ${entry.name === null ? "" : `${compactSummary(entry.name, 80)}. `}${entry.description === null ? "" : `${compactSummary(entry.description, 100)} `}${entry.skillCount} skills`,
        );
  const ending = `browse returns the full folder contents with continuation.\n${HOW_TO}`;
  let result = `${compactSummary(summary, INSTRUCTIONS_MAX_LENGTH - ending.length - 1)}\n`;
  const overview =
    catalog.overview === undefined
      ? undefined
      : `Optional overview: read_file ${catalog.overview.path}.`;
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
