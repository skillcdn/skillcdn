import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import {
  MAX_OPTIONAL_FIELD_LENGTH,
  optionalText,
  readMetadata,
  requiredText,
} from "./manifest-fields.js";
import { err, ok, type Result } from "./result.js";

// Field rules follow the Agent Skills specification; see docs/specs/skill-repo.md.

export const MAX_SKILL_MANIFEST_LENGTH = 262_144;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_COMPATIBILITY_LENGTH = 500;

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
  const ignored = (message: string): void => {
    warnings.push({ code: "ignored_field", message });
  };

  return ok({
    manifest: {
      name,
      description,
      license: optionalText(fields, "license", MAX_OPTIONAL_FIELD_LENGTH, ignored),
      compatibility: optionalText(fields, "compatibility", MAX_SKILL_COMPATIBILITY_LENGTH, ignored),
      allowedTools: optionalText(fields, "allowed-tools", MAX_OPTIONAL_FIELD_LENGTH, ignored),
      metadata: readMetadata(fields.get("metadata"), ignored),
      body: split.body,
    },
    warnings,
  });
}
