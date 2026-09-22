import { joinRepoPath, type RepoPath, ROOT_PATH } from "./repo-path.js";

// How SkillCDN reads a repository; see docs/specs/skill-repo.md.

/** A directory that holds a file with exactly this name is a skill. */
export const SKILL_MANIFEST_FILE = "SKILL.md";

/** The repository manifest: a file with exactly this name governs the directory it is in. */
export const REPO_MANIFEST_FILE = "SKILLCDN.md";

/**
 * What a file is to the index, judged by its name alone:
 * - `skill`: a skill manifest;
 * - `manifest`: a repository manifest;
 * - `markdown`, `json`: a document whose text is searchable;
 * - `other`: listed and readable, never searched.
 */
export type RepoFileKind = "skill" | "manifest" | "markdown" | "json" | "other";

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
  if (name === REPO_MANIFEST_FILE) {
    return "manifest";
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
  return nearestDirectoryAtOrAbove(parentDirectory(path), skillDirectories);
}

/** The nearest of `directories` that is `directory` itself or one of its ancestors. */
export function nearestDirectoryAtOrAbove(
  directory: RepoPath,
  directories: ReadonlySet<RepoPath>,
): RepoPath | undefined {
  let current = directory;
  while (true) {
    if (directories.has(current)) {
      return current;
    }
    if (current === ROOT_PATH) {
      return undefined;
    }
    current = parentDirectory(current);
  }
}

/** The path of the repository manifest that governs `directory`, were there one. */
export function repoManifestPath(directory: RepoPath): RepoPath {
  return joinRepoPath(directory, REPO_MANIFEST_FILE as RepoPath);
}

/** What decides whether a file is served: the skills, and the manifests with what they declare. */
export interface ServedScope {
  readonly skillDirectories: ReadonlySet<RepoPath>;
  readonly manifestDirectories: ReadonlySet<RepoPath>;
  /** Per manifest directory, the document directories it declares, as absolute paths. */
  readonly documentDirectories: ReadonlyMap<RepoPath, readonly RepoPath[]>;
}

/**
 * Whether a file is served. A file governed by no manifest (none in its directory or above)
 * always is. Under a manifest, only the files of skills, the files in the directories the
 * manifest declares, and the manifest itself are; the rest is neither listed, searched nor read.
 */
export function isServedPath(path: RepoPath, scope: ServedScope): boolean {
  const governing = nearestDirectoryAtOrAbove(parentDirectory(path), scope.manifestDirectories);
  if (governing === undefined) {
    return true;
  }
  if (path === repoManifestPath(governing)) {
    return true;
  }
  if (owningSkillDirectory(path, scope.skillDirectories) !== undefined) {
    return true;
  }
  const declared = scope.documentDirectories.get(governing) ?? [];
  return declared.some((directory) => directory === ROOT_PATH || path.startsWith(`${directory}/`));
}
