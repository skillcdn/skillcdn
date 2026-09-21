import { hasForbiddenCodePoint } from "./text-safety.js";

export const MAX_REF_LENGTH = 255;

const FULL_COMMIT_HASH = /^[0-9a-f]{40}$/i;
const REF_FORBIDDEN_CHARACTERS = /[ ~^:?*[\\]/;

/** A full commit hash is the only ref that can never move. */
export function isFullCommitHash(value: string): boolean {
  return FULL_COMMIT_HASH.test(value);
}

/**
 * The rules of `git check-ref-format --allow-onelevel`, plus our own text-safety rules and a
 * length cap. Pure syntax: it says nothing about whether the ref exists.
 */
export function isValidRefName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_REF_LENGTH) {
    return false;
  }
  if (hasForbiddenCodePoint(name) || REF_FORBIDDEN_CHARACTERS.test(name)) {
    return false;
  }
  if (name === "@" || name.includes("@{") || name.includes("..") || name.endsWith(".")) {
    return false;
  }
  // A leading "-" is legal for some refs but reads as an option anywhere a ref meets a command line.
  if (name.startsWith("-")) {
    return false;
  }
  for (const component of name.split("/")) {
    if (component.length === 0 || component.startsWith(".") || component.endsWith(".lock")) {
      return false;
    }
  }
  return true;
}
