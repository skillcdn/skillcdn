import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import { err, ok, type Result } from "./result.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

// Field rules follow the Agent Skills specification; see docs/specs/skill-repo.md.

export const MAX_SKILL_MANIFEST_LENGTH = 262_144;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_COMPATIBILITY_LENGTH = 500;
const MAX_OPTIONAL_FIELD_LENGTH = 1024;
const MAX_METADATA_ENTRIES = 64;
const MAX_METADATA_KEY_LENGTH = 128;

const CONVENTIONAL_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly license: string | undefined;
  readonly compatibility: string | undefined;
  /** Passed through as written. SkillCDN grants nothing on the strength of this field. */
  readonly allowedTools: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
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
  | "ignored_field";

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

/** A required single-line-ish text field: a non-empty string within `maxLength`, safe to display. */
function requiredText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength || hasUnsafeText(text)) {
    return undefined;
  }
  return text;
}

/** Line breaks and tabs are ordinary in folded YAML text; every other control character is not. */
function hasUnsafeText(text: string): boolean {
  return hasForbiddenCodePoint(text.replaceAll(/[\n\r\t]/g, " "));
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

  const name = requiredText(fields.get("name"), MAX_SKILL_NAME_LENGTH);
  if (name === undefined || /[\n\r\t]/.test(name)) {
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

  const optionalText = (field: string, maxLength: number): string | undefined => {
    const value = fields.get(field);
    if (value === undefined || value === null) {
      return undefined;
    }
    const parsed = requiredText(value, maxLength);
    if (parsed === undefined) {
      warnings.push({
        code: "ignored_field",
        message: `"${field}" is ignored: expected 1 to ${maxLength} characters of text`,
      });
    }
    return parsed;
  };

  return ok({
    manifest: {
      name,
      description,
      license: optionalText("license", MAX_OPTIONAL_FIELD_LENGTH),
      compatibility: optionalText("compatibility", MAX_SKILL_COMPATIBILITY_LENGTH),
      allowedTools: optionalText("allowed-tools", MAX_OPTIONAL_FIELD_LENGTH),
      metadata: readMetadata(fields.get("metadata"), warnings),
      body: split.body,
    },
    warnings,
  });
}

function readMetadata(
  value: unknown,
  warnings: SkillManifestWarning[],
): Readonly<Record<string, string>> {
  // A null prototype keeps author-chosen keys such as "__proto__" ordinary.
  const metadata: Record<string, string> = Object.create(null);
  if (value === undefined || value === null) {
    return metadata;
  }
  if (!(value instanceof Map)) {
    warnings.push({ code: "ignored_field", message: '"metadata" is ignored: expected a mapping' });
    return metadata;
  }
  let kept = 0;
  let dropped = 0;
  for (const [key, entry] of value) {
    const text = requiredText(entry, MAX_OPTIONAL_FIELD_LENGTH);
    const usable =
      typeof key === "string" &&
      key.length > 0 &&
      key.length <= MAX_METADATA_KEY_LENGTH &&
      !hasForbiddenCodePoint(key) &&
      text !== undefined &&
      kept < MAX_METADATA_ENTRIES;
    if (usable) {
      metadata[key] = text;
      kept += 1;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    warnings.push({
      code: "ignored_field",
      message: `${dropped} "metadata" entries are ignored: expected short text keys and values`,
    });
  }
  return metadata;
}
