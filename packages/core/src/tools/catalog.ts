import type { RepoPath } from "../repo-path.js";
import { searchTool } from "./contracts.js";
import { describeMount, plural } from "./render.js";
import type { BrowseEntry, IndexDiagnostic, MountSummary } from "./results.js";

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
  | { readonly status: "indexing" | "failed"; readonly mount: MountSummary };
export const INSTRUCTIONS_MAX_LENGTH = 2000;
export const FIND_DESCRIPTION_MAX_LENGTH = 800;
const HOW_TO =
  "Use browse to explore folders and search to match words. Load a skill with get_skill using its exact SKILL.md path; follow nextCursor until complete before applying it. read_file reads references. All paths start at the repository root and stay within the mounted folder.";
const clip = (text: string, length: number): string => {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`;
};

/** A bounded introduction; complete discovery always remains available through browse. */
export function renderInstructions(state: CatalogState): string {
  const mount = state.status === "ready" ? state.catalog.mount : state.mount;
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  const head = `Skills and documents from ${describeMount(mount)}.${manifest === undefined ? "" : ` ${manifest.name ?? mount.repository}: ${clip(manifest.description, 300)}`}`;
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
          .map((item) => clip(item.path, 80))
          .join(", ")}); browse reports diagnostics.`;
  const summary = `${head} ${plural(catalog.skillCount, "skill")}, ${plural(catalog.documentCount, "document")}.${language}${diagnostics}`;
  const rows =
    catalog.groups === undefined
      ? catalog.skills.map(
          (skill) =>
            `${skill.directory ? `${skill.directory}/` : ""}SKILL.md: ${clip(skill.description, 90)}`,
        )
      : catalog.groups.map(
          (entry) =>
            `${entry.path}${entry.kind === "directory" ? "/" : ""}: ${entry.name === null ? "" : `${entry.name}. `}${entry.description === null ? "" : `${clip(entry.description, 100)} `}${entry.skillCount} skills`,
        );
  const ending = `browse returns the full folder contents with continuation.\n${HOW_TO}`;
  let result = `${clip(summary, INSTRUCTIONS_MAX_LENGTH - ending.length - 1)}\n`;
  for (const row of rows) {
    if (result.length + row.length + ending.length + 1 > INSTRUCTIONS_MAX_LENGTH) break;
    result += `${row}\n`;
  }
  return `${result}${ending}`;
}

/** Short tool description for clients that do not expose server instructions. */
export function describeFindTool(state: CatalogState): string {
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  const about = manifest === undefined ? "" : ` ${clip(manifest.description, 180)}`;
  return `${searchTool.description}${about}${manifest?.language === undefined ? "" : ` Written in ${manifest.language}.`}`.slice(
    0,
    FIND_DESCRIPTION_MAX_LENGTH,
  );
}
