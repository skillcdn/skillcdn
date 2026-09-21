import { err, ok, type Result } from "./result.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

declare const repoPathBrand: unique symbol;

/**
 * A validated path inside a repository: `""` is the root, otherwise `a/b/c`. Only
 * {@link parseRepoPath} produces one, so holding a `RepoPath` means traversal is ruled out.
 */
export type RepoPath = string & { readonly [repoPathBrand]: true };

export const ROOT_PATH = "" as RepoPath;
export const MAX_REPO_PATH_LENGTH = 1024;

export type RepoPathErrorCode =
  | "too_long"
  | "absolute"
  | "empty_segment"
  | "dot_segment"
  | "forbidden_character";

export interface RepoPathError {
  readonly code: RepoPathErrorCode;
  readonly message: string;
}

function fail(code: RepoPathErrorCode, message: string): Result<RepoPath, RepoPathError> {
  return err({ code, message });
}

/** Validates a repository-relative path. Rejects instead of repairing; never throws. */
export function parseRepoPath(input: string): Result<RepoPath, RepoPathError> {
  if (input.length === 0) {
    return ok(ROOT_PATH);
  }
  if (input.length > MAX_REPO_PATH_LENGTH) {
    return fail("too_long", `path is longer than ${MAX_REPO_PATH_LENGTH} characters`);
  }
  if (input.startsWith("/")) {
    return fail("absolute", "path must be relative to the repository root");
  }
  if (input.includes("\\") || hasForbiddenCodePoint(input)) {
    return fail("forbidden_character", "path contains a backslash or a control character");
  }
  for (const segment of input.split("/")) {
    if (segment.length === 0) {
      return fail("empty_segment", "path contains an empty segment");
    }
    if (segment === "." || segment === "..") {
      return fail("dot_segment", 'path contains a "." or ".." segment');
    }
  }
  return ok(input as RepoPath);
}

/** Joins two validated paths. The result cannot leave `base` because neither side can contain `..`. */
export function joinRepoPath(base: RepoPath, relative: RepoPath): RepoPath {
  if (base.length === 0) {
    return relative;
  }
  if (relative.length === 0) {
    return base;
  }
  return `${base}/${relative}` as RepoPath;
}

/** True when `candidate` is `root` itself or lies beneath it. */
export function isWithinRepoPath(root: RepoPath, candidate: RepoPath): boolean {
  return root.length === 0 || candidate === root || candidate.startsWith(`${root}/`);
}

/** The part of `candidate` below `root`, or `undefined` when it is not inside `root`. */
export function relativeRepoPath(root: RepoPath, candidate: RepoPath): RepoPath | undefined {
  if (!isWithinRepoPath(root, candidate)) {
    return undefined;
  }
  if (root.length === 0) {
    return candidate;
  }
  return candidate.slice(root.length + 1) as RepoPath;
}
