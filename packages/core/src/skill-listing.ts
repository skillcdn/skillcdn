import { baseName, isHiddenPath } from "./repo-layout.js";
import type { RepoPath } from "./repo-path.js";

/**
 * Which skills the MCP skills extension lists (ADR-0025): a host holds a skill as a whole, so
 * the skill has to be one a host can hold. The others stay available through the tools, and
 * the reason they are not listed is reported.
 */

/** The extension's own bounds for one skill. */
export const SKILL_LISTING_MAX_FILES = 512;
export const SKILL_LISTING_MAX_BYTES = 16 * 1024 * 1024;

export type SkillListingProblem =
  /** The directory is not named after the skill, which the extension's URI rule requires. */
  | "name_directory_mismatch"
  | "too_many_files"
  | "too_large"
  /** A file of the skill is over the read limit or was not stored, so it cannot be served whole. */
  | "file_unavailable"
  /** Identical to a skill listed at another path. */
  | "duplicate"
  /** Under a hidden directory while the repository has visible skills. */
  | "hidden"
  /** A root skill whose name is also a directory of the repository, so its URI would be ambiguous. */
  | "uri_collision";

export interface SkillListingFile {
  readonly size: number;
  /** True when the bytes are stored and within the read limit. */
  readonly available: boolean;
}

export interface SkillListingInput {
  readonly directory: RepoPath;
  readonly name: string;
  /** Every served file of the skill, its own manifest included. */
  readonly files: readonly SkillListingFile[];
}

/** Why a skill cannot be listed on its own, before duplicates and hidden copies are considered. */
export function skillListingProblem(input: SkillListingInput): SkillListingProblem | undefined {
  if (input.directory.length > 0 && baseName(input.directory) !== input.name) {
    return "name_directory_mismatch";
  }
  if (input.files.length > SKILL_LISTING_MAX_FILES) return "too_many_files";
  if (input.files.reduce((total, file) => total + file.size, 0) > SKILL_LISTING_MAX_BYTES) {
    return "too_large";
  }
  if (input.files.some((file) => !file.available)) return "file_unavailable";
  return undefined;
}

/** A skill under a hidden directory is one a person did not mean to publish as such. */
export function isHiddenSkill(directory: RepoPath): boolean {
  return directory.length > 0 && isHiddenPath(directory);
}

export function describeListingProblem(problem: SkillListingProblem, detail?: string): string {
  switch (problem) {
    case "name_directory_mismatch":
      return "Not listed through the skills extension: the directory must be named after the skill.";
    case "too_many_files":
      return `Not listed through the skills extension: a skill may have at most ${SKILL_LISTING_MAX_FILES} files.`;
    case "too_large":
      return `Not listed through the skills extension: a skill may total at most ${SKILL_LISTING_MAX_BYTES} bytes.`;
    case "file_unavailable":
      return `Not listed through the skills extension: a file of the skill could not be served whole${detail === undefined ? "" : ` (${detail})`}.`;
    case "duplicate":
      return `Listed once through the skills extension${detail === undefined ? "" : `, as ${detail}`}: this copy is identical.`;
    case "hidden":
      return "Not listed or searched: a skill under a hidden directory is discoverable only when the repository has no visible skill.";
    case "uri_collision":
      return `Not listed through the skills extension: the repository has a directory named after the root skill${detail === undefined ? "" : ` (${detail})`}.`;
  }
}
