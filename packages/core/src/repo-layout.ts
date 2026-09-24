import { joinRepoPath, type RepoPath, ROOT_PATH, relativeRepoPath } from "./repo-path.js";

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
 * Hidden paths require a publication declaration: a skill root, document directory, include,
 * or local Markdown link. A declaration does not implicitly open further hidden descendants.
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

/**
 * Where the documents are unless a manifest says otherwise: the conventional directory, at the
 * root of the repository or next to the manifest.
 */
export const DEFAULT_DOCUMENT_DIRECTORIES: readonly RepoPath[] = ["docs" as RepoPath];

/** What decides whether a file is served: the skills, and the manifests with what they declare. */
export interface ServedScope {
  readonly skillDirectories: ReadonlySet<RepoPath>;
  readonly manifestDirectories: ReadonlySet<RepoPath>;
  /** Per manifest directory, the document directories it declares, as absolute paths. */
  readonly documentDirectories: ReadonlyMap<RepoPath, readonly RepoPath[]>;
  /** Explicit `skillcdn.include` files, in repository-root coordinates. */
  readonly includedFiles?: ReadonlySet<RepoPath>;
}

/** Whether `path` is in `directory`; the root holds everything. */
function isPublicDescendant(path: RepoPath, directory: RepoPath): boolean {
  const relative = relativeRepoPath(directory, path);
  return relative !== undefined && relative.length > 0 && !isHiddenPath(relative);
}

/**
 * Whether a file is served. The files of a skill always are. Outside the skills, the manifest
 * that governs the file (the nearest in its directory or above) decides: the manifest itself and
 * the directories it declares are served, nothing else. Where no manifest governs, the repository
 * is read as if its root declared the default directories: `docs`, and nothing else.
 */
export function isServedPath(path: RepoPath, scope: ServedScope): boolean {
  const skill = owningSkillDirectory(path, scope.skillDirectories);
  if ((skill !== undefined && isPublicDescendant(path, skill)) || scope.includedFiles?.has(path)) {
    return true;
  }
  const governing = nearestDirectoryAtOrAbove(parentDirectory(path), scope.manifestDirectories);
  if (governing === undefined) {
    return DEFAULT_DOCUMENT_DIRECTORIES.some((directory) => isPublicDescendant(path, directory));
  }
  if (path === repoManifestPath(governing)) {
    return true;
  }
  const declared = scope.documentDirectories.get(governing) ?? [];
  return declared.some((directory) => isPublicDescendant(path, directory));
}
