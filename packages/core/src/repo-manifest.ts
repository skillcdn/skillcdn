import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import {
  MAX_OPTIONAL_FIELD_LENGTH,
  optionalText,
  readMetadata,
  requiredText,
} from "./manifest-fields.js";
import { DEFAULT_DOCUMENT_DIRECTORIES } from "./repo-layout.js";
import { parseRepoPath, type RepoPath, ROOT_PATH } from "./repo-path.js";
import { err, ok, type Result } from "./result.js";

// The repository manifest, SKILLCDN.md: what a client is told about a repository, which
// directories hold the documents it serves, and the rules that hold for every skill in it. See
// docs/specs/skill-repo.md, "The repository manifest".

export const MAX_REPO_MANIFEST_LENGTH = 262_144;
export const MAX_REPO_NAME_LENGTH = 100;
export const MAX_REPO_DESCRIPTION_LENGTH = 1024;
export const MAX_DOCUMENT_DIRECTORIES = 20;

export interface RepoManifest {
  /** Absent: the repository is named as its git host names it. */
  readonly name: string | undefined;
  readonly description: string;
  /**
   * Directories whose files are served, relative to the manifest's own directory; the root path
   * stands for that directory itself. The default directories when the field is absent, none
   * when it is an empty sequence. Nothing else outside the skills is served.
   */
  readonly documents: readonly RepoPath[];
  readonly license: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
  /** The Markdown after the front-matter: the rules that hold for every skill. */
  readonly body: string;
}

export type RepoManifestErrorCode =
  | "too_large"
  | "missing_front_matter"
  | "unterminated_front_matter"
  | "invalid_front_matter"
  | "invalid_description";

/** Why a manifest could not be read. The repository then serves its skills and nothing else. */
export interface RepoManifestError {
  readonly code: RepoManifestErrorCode;
  readonly message: string;
}

export type RepoManifestWarningCode = "ignored_field" | "ignored_directory";

export interface RepoManifestWarning {
  readonly code: RepoManifestWarningCode;
  readonly message: string;
}

export interface ParsedRepoManifest {
  readonly manifest: RepoManifest;
  readonly warnings: readonly RepoManifestWarning[];
}

function fail(
  code: RepoManifestErrorCode,
  message: string,
): Result<ParsedRepoManifest, RepoManifestError> {
  return err({ code, message });
}

/**
 * Parses a `SKILLCDN.md`. Total: every input yields a manifest with warnings, or the reason it
 * cannot be read. Unknown front-matter fields are ignored so the format can grow.
 */
export function parseRepoManifest(text: string): Result<ParsedRepoManifest, RepoManifestError> {
  if (text.length > MAX_REPO_MANIFEST_LENGTH) {
    return fail("too_large", `SKILLCDN.md is longer than ${MAX_REPO_MANIFEST_LENGTH} characters`);
  }
  const split = splitFrontMatter(text);
  if (split.kind === "none") {
    return fail("missing_front_matter", "SKILLCDN.md must start with YAML front-matter");
  }
  if (split.kind === "unterminated") {
    return fail("unterminated_front_matter", 'the front-matter has no closing "---" line');
  }
  const frontMatter = parseFrontMatter(split.source);
  if (!frontMatter.ok) {
    return fail("invalid_front_matter", frontMatter.error.message);
  }
  const fields = frontMatter.value;

  const description = requiredText(fields.get("description"), MAX_REPO_DESCRIPTION_LENGTH);
  if (description === undefined) {
    return fail(
      "invalid_description",
      `"description" must be 1 to ${MAX_REPO_DESCRIPTION_LENGTH} characters of text`,
    );
  }

  const warnings: RepoManifestWarning[] = [];
  const ignored = (message: string): void => {
    warnings.push({ code: "ignored_field", message });
  };
  let name = optionalText(fields, "name", MAX_REPO_NAME_LENGTH, ignored);
  if (name !== undefined && /[\n\r\t]/.test(name)) {
    ignored('"name" is ignored: expected one line of text');
    name = undefined;
  }

  return ok({
    manifest: {
      name,
      description,
      documents: readDocuments(fields.get("documents"), warnings),
      license: optionalText(fields, "license", MAX_OPTIONAL_FIELD_LENGTH, ignored),
      metadata: readMetadata(fields.get("metadata"), ignored),
      body: split.body,
    },
    warnings,
  });
}

/**
 * The `documents` sequence: relative directories, `.` for the manifest's own directory; the
 * default directories when the field is absent. An entry that is not a plain relative path is
 * dropped and reported, never guessed at, so that a typo cannot serve more than the author meant.
 */
function readDocuments(value: unknown, warnings: RepoManifestWarning[]): readonly RepoPath[] {
  if (value === undefined) {
    return DEFAULT_DOCUMENT_DIRECTORIES;
  }
  if (value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    warnings.push({
      code: "ignored_field",
      message: '"documents" is ignored: expected a sequence of directories',
    });
    return [];
  }
  const directories: RepoPath[] = [];
  let dropped = 0;
  for (const item of value) {
    if (directories.length >= MAX_DOCUMENT_DIRECTORIES) {
      dropped += 1;
      continue;
    }
    // `docs/` is how people write a directory; the slash says nothing the path does not.
    const text = typeof item === "string" ? item.trim().replace(/\/+$/, "") : undefined;
    const parsed =
      text === undefined
        ? undefined
        : text === "."
          ? { ok: true as const, value: ROOT_PATH }
          : parseRepoPath(text);
    if (parsed === undefined || !parsed.ok) {
      dropped += 1;
      continue;
    }
    if (!directories.includes(parsed.value)) {
      directories.push(parsed.value);
    }
  }
  if (dropped > 0) {
    warnings.push({
      code: "ignored_directory",
      message: `${dropped} "documents" entries are ignored: expected at most ${MAX_DOCUMENT_DIRECTORIES} relative directories without "." or ".." segments`,
    });
  }
  return directories;
}
