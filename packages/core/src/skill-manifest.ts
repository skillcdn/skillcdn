import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import {
  commentedValueWarnings,
  MAX_OPTIONAL_FIELD_LENGTH,
  optionalText,
  readMetadata,
  readTranslations,
  requiredLine,
  requiredText,
} from "./manifest-fields.js";
import { classifyRepoFile, isHiddenPath } from "./repo-layout.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";
import { err, ok, type Result } from "./result.js";

// Field rules follow the Agent Skills specification; what SkillCDN adds lives under one key,
// `skillcdn`, so that the top level stays the specification's. See docs/specs/skill-repo.md.

export const MAX_SKILL_MANIFEST_LENGTH = 262_144;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_COMPATIBILITY_LENGTH = 500;
/** A translated title is for people, so it may be longer than a name. */
export const MAX_SKILL_TITLE_LENGTH = 200;
/** How many files a skill may declare as returned with it. */
export const MAX_INCLUDED_FILES = 20;

const CONVENTIONAL_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What people see in one language instead of the name and the description. */
export interface SkillTranslation {
  readonly title: string | undefined;
  readonly description: string | undefined;
}

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly license: string | undefined;
  readonly compatibility: string | undefined;
  /** Passed through as written. SkillCDN grants nothing on the strength of this field. */
  readonly allowedTools: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
  /**
   * Files the skill needs on every run, relative to its directory: `get` returns them with
   * the skill, so that an agent does not read them one by one.
   */
  readonly include: readonly RepoPath[];
  /** The title and the description in other languages, by language tag. */
  readonly translations: Readonly<Record<string, SkillTranslation>>;
  /** The Markdown after the front-matter. */
  readonly body: string;
}

export type SkillManifestErrorCode =
  | "too_large"
  | "missing_front_matter"
  | "unterminated_front_matter"
  | "invalid_front_matter"
  | "invalid_name"
  | "invalid_description";

/** Why a manifest was skipped. */
export interface SkillManifestError {
  readonly code: SkillManifestErrorCode;
  readonly message: string;
}

export type SkillManifestWarningCode =
  | "unconventional_name"
  | "name_directory_mismatch"
  | "ignored_field"
  | "commented_value";

/** Something the author should fix that does not stop the skill from being served. */
export interface SkillManifestWarning {
  readonly code: SkillManifestWarningCode;
  readonly message: string;
}

export interface ParsedSkillManifest {
  readonly manifest: SkillManifest;
  readonly warnings: readonly SkillManifestWarning[];
}

export interface SkillManifestContext {
  /** Name of the directory holding the manifest; `undefined` when that is the mounted root. */
  readonly directoryName: string | undefined;
}

function fail(
  code: SkillManifestErrorCode,
  message: string,
): Result<ParsedSkillManifest, SkillManifestError> {
  return err({ code, message });
}

/**
 * The `include` sequence: paths of Markdown or JSON files inside the skill directory. An entry
 * that is anything else is dropped and reported, never guessed at.
 */
function readIncludedFiles(value: unknown, ignored: (message: string) => void): RepoPath[] {
  if (value === undefined || value === null) {
    return [];
  }
  const files: RepoPath[] = [];
  let dropped = 0;
  for (const item of Array.isArray(value) ? value : [undefined]) {
    const parsed = typeof item === "string" ? parseRepoPath(item.trim()) : undefined;
    const kind = parsed?.ok === true ? classifyRepoFile(parsed.value) : undefined;
    const usable =
      parsed?.ok === true &&
      parsed.value.length > 0 &&
      !isHiddenPath(parsed.value) &&
      (kind === "markdown" || kind === "json") &&
      files.length < MAX_INCLUDED_FILES;
    if (!usable) {
      dropped += 1;
    } else if (!files.includes(parsed.value)) {
      files.push(parsed.value);
    }
  }
  if (dropped > 0) {
    ignored(
      `${dropped} "skillcdn.include" entries are ignored: expected at most ${MAX_INCLUDED_FILES} relative paths of Markdown or JSON files inside the skill directory`,
    );
  }
  return files;
}

function pickSkillTranslation(fields: ReadonlyMap<unknown, unknown>): SkillTranslation | undefined {
  const title = requiredLine(fields.get("title"), MAX_SKILL_TITLE_LENGTH);
  const description = requiredText(fields.get("description"), MAX_SKILL_DESCRIPTION_LENGTH);
  return title === undefined && description === undefined ? undefined : { title, description };
}

/**
 * Parses a `SKILL.md`. Total: every input yields a manifest with warnings, or the reason the
 * manifest is skipped. Unknown front-matter fields are ignored so the convention can grow.
 */
export function parseSkillManifest(
  text: string,
  context: SkillManifestContext,
): Result<ParsedSkillManifest, SkillManifestError> {
  if (text.length > MAX_SKILL_MANIFEST_LENGTH) {
    return fail("too_large", `SKILL.md is longer than ${MAX_SKILL_MANIFEST_LENGTH} characters`);
  }
  const split = splitFrontMatter(text);
  if (split.kind === "none") {
    return fail("missing_front_matter", "SKILL.md must start with YAML front-matter");
  }
  if (split.kind === "unterminated") {
    return fail("unterminated_front_matter", 'the front-matter has no closing "---" line');
  }
  const frontMatter = parseFrontMatter(split.source);
  if (!frontMatter.ok) {
    return fail("invalid_front_matter", frontMatter.error.message);
  }
  const fields = frontMatter.value;

  const name = requiredLine(fields.get("name"), MAX_SKILL_NAME_LENGTH);
  if (name === undefined) {
    return fail("invalid_name", `"name" must be 1 to ${MAX_SKILL_NAME_LENGTH} characters of text`);
  }
  const description = requiredText(fields.get("description"), MAX_SKILL_DESCRIPTION_LENGTH);
  if (description === undefined) {
    return fail(
      "invalid_description",
      `"description" must be 1 to ${MAX_SKILL_DESCRIPTION_LENGTH} characters of text`,
    );
  }

  const warnings: SkillManifestWarning[] = [];
  if (!CONVENTIONAL_SKILL_NAME.test(name)) {
    warnings.push({
      code: "unconventional_name",
      message: '"name" should use lowercase letters, digits and single hyphens only',
    });
  }
  if (context.directoryName !== undefined && context.directoryName !== name) {
    warnings.push({
      code: "name_directory_mismatch",
      message: '"name" should match the name of the directory that holds SKILL.md',
    });
  }
  for (const message of commentedValueWarnings(split.source, ["name", "description"])) {
    warnings.push({ code: "commented_value", message });
  }
  const ignored = (message: string): void => {
    warnings.push({ code: "ignored_field", message });
  };

  let include: readonly RepoPath[] = [];
  let translations: Readonly<Record<string, SkillTranslation>> = Object.create(null);
  const own = fields.get("skillcdn");
  if (own instanceof Map) {
    include = readIncludedFiles(own.get("include"), ignored);
    translations = readTranslations(own.get("translations"), pickSkillTranslation, ignored);
  } else if (own !== undefined && own !== null) {
    ignored('"skillcdn" is ignored: expected a mapping');
  }

  return ok({
    manifest: {
      name,
      description,
      license: optionalText(fields, "license", MAX_OPTIONAL_FIELD_LENGTH, ignored),
      compatibility: optionalText(fields, "compatibility", MAX_SKILL_COMPATIBILITY_LENGTH, ignored),
      allowedTools: optionalText(fields, "allowed-tools", MAX_OPTIONAL_FIELD_LENGTH, ignored),
      metadata: readMetadata(fields.get("metadata"), ignored),
      include,
      translations,
      body: split.body,
    },
    warnings,
  });
}
