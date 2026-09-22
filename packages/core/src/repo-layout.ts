import { type RepoPath, ROOT_PATH } from "./repo-path.js";

// How SkillCDN reads a repository; see docs/specs/skill-repo.md.

/** A directory that holds a file with exactly this name is a skill. */
export const SKILL_MANIFEST_FILE = "SKILL.md";

/**
 * What a file is to the index, judged by its name alone:
 * - `skill`: a skill manifest;
 * - `markdown`, `json`: a document whose text is searchable;
 * - `other`: listed and readable, never searched.
 */
export type RepoFileKind = "skill" | "markdown" | "json" | "other";

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"];

export function baseName(path: RepoPath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The directory that contains `path`; the root for a top-level entry. */
export function parentDirectory(path: RepoPath): RepoPath {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? ROOT_PATH : (path.slice(0, slash) as RepoPath);
}

/**
 * Hidden entries are never listed, searched or read: any file with a segment that starts with a
 * dot, such as `.github/workflows/ci.yml`, `.editorconfig` or `.claude/settings.json`. They are
 * tooling for the repository, not content for an agent.
 */
export function isHiddenPath(path: RepoPath): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

export function classifyRepoFile(path: RepoPath): RepoFileKind {
  const name = baseName(path);
  if (name === SKILL_MANIFEST_FILE) {
    return "skill";
  }
  const lowerName = name.toLowerCase();
  if (MARKDOWN_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return "markdown";
  }
  return lowerName.endsWith(".json") ? "json" : "other";
}

/**
 * The skill a file belongs to: the nearest directory, walking up from the file, that is in
 * `skillDirectories`. A nested skill owns its own files; the outer skill does not.
 */
export function owningSkillDirectory(
  path: RepoPath,
  skillDirectories: ReadonlySet<RepoPath>,
): RepoPath | undefined {
  let directory = parentDirectory(path);
  while (true) {
    if (skillDirectories.has(directory)) {
      return directory;
    }
    if (directory === ROOT_PATH) {
      return undefined;
    }
    directory = parentDirectory(directory);
  }
}
