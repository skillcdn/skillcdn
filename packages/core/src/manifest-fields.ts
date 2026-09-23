import { hasForbiddenCodePoint } from "./text-safety.js";

// Field rules shared by the two manifests, SKILL.md and SKILLCDN.md; see docs/specs/skill-repo.md.

export const MAX_OPTIONAL_FIELD_LENGTH = 1024;
const MAX_METADATA_ENTRIES = 64;
const MAX_METADATA_KEY_LENGTH = 128;
/** How many languages a manifest may carry translations for. */
export const MAX_TRANSLATIONS = 32;

/** A language tag as authors write one: `ko`, `pt-BR`, `zh-Hant`. */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

export function isLanguageTag(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE_TAG.test(value);
}

/** Line breaks and tabs are ordinary in folded YAML text; every other control character is not. */
function hasUnsafeText(text: string): boolean {
  return hasForbiddenCodePoint(text.replaceAll(/[\n\r\t]/g, " "));
}

/** A required text field: a non-empty string within `maxLength`, safe to display. */
export function requiredText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength || hasUnsafeText(text)) {
    return undefined;
  }
  return text;
}

/** A required text field that has to fit on one line. */
export function requiredLine(value: unknown, maxLength: number): string | undefined {
  const text = requiredText(value, maxLength);
  return text === undefined || /[\n\r\t]/.test(text) ? undefined : text;
}

/** An optional text field: absent is fine; present but unusable is reported and ignored. */
export function optionalText(
  fields: ReadonlyMap<unknown, unknown>,
  field: string,
  maxLength: number,
  ignored: (message: string) => void,
): string | undefined {
  const value = fields.get(field);
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = requiredText(value, maxLength);
  if (parsed === undefined) {
    ignored(`"${field}" is ignored: expected 1 to ${maxLength} characters of text`);
  }
  return parsed;
}

/** The optional `language` field: the tag of the language the content is written in. */
export function optionalLanguage(
  fields: ReadonlyMap<unknown, unknown>,
  ignored: (message: string) => void,
): string | undefined {
  const value = fields.get("language");
  if (value === undefined || value === null) {
    return undefined;
  }
  const tag = typeof value === "string" ? value.trim() : undefined;
  if (!isLanguageTag(tag)) {
    ignored('"language" is ignored: expected a language tag such as "en" or "pt-BR"');
    return undefined;
  }
  return tag;
}

/** The `metadata` mapping: short text keys to short text values, anything else reported. */
export function readMetadata(
  value: unknown,
  ignored: (message: string) => void,
): Readonly<Record<string, string>> {
  // A null prototype keeps author-chosen keys such as "__proto__" ordinary.
  const metadata: Record<string, string> = Object.create(null);
  if (value === undefined || value === null) {
    return metadata;
  }
  if (!(value instanceof Map)) {
    ignored('"metadata" is ignored: expected a mapping');
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
    ignored(`${dropped} "metadata" entries are ignored: expected short text keys and values`);
  }
  return metadata;
}

/**
 * The `translations` mapping: a language tag to the fields written in that language. `pick`
 * reads the fields one manifest translates and answers `undefined` when none is usable. An
 * entry that is not a tag, not a mapping, or translates nothing is dropped and reported.
 */
export function readTranslations<T>(
  value: unknown,
  pick: (fields: ReadonlyMap<unknown, unknown>) => T | undefined,
  ignored: (message: string) => void,
): Readonly<Record<string, T>> {
  const translations: Record<string, T> = Object.create(null);
  if (value === undefined || value === null) {
    return translations;
  }
  if (!(value instanceof Map)) {
    ignored('"translations" is ignored: expected a mapping from language tags');
    return translations;
  }
  let kept = 0;
  let dropped = 0;
  for (const [tag, entry] of value) {
    const picked =
      isLanguageTag(tag) && entry instanceof Map && kept < MAX_TRANSLATIONS
        ? pick(entry)
        : undefined;
    if (picked === undefined) {
      dropped += 1;
      continue;
    }
    translations[tag] = picked;
    kept += 1;
  }
  if (dropped > 0) {
    ignored(
      `${dropped} "translations" entries are ignored: expected at most ${MAX_TRANSLATIONS} language tags such as "ko", each mapping to translated fields`,
    );
  }
  return translations;
}

/** The first character of a plain scalar that YAML reads as something other than text. */
const QUOTED_OR_BLOCK = /^["'|>]/;

/**
 * The mistakes that turn a sentence into something else without a parse error: YAML reads
 * " #" in a plain scalar as the start of a comment and drops the rest of the line. The parser
 * cannot tell, so the source of the front-matter is scanned for the fields that matter.
 */
export function commentedValueWarnings(source: string, keys: readonly string[]): string[] {
  const warnings: string[] = [];
  for (const line of source.split("\n")) {
    const match = /^([A-Za-z][\w-]*):[ \t]+(\S.*)$/.exec(line.slice(0, 2000));
    if (match === null) {
      continue;
    }
    const [, key = "", value = ""] = match;
    if (keys.includes(key) && !QUOTED_OR_BLOCK.test(value) && /[ \t]#/.test(value)) {
      warnings.push(
        `the value of "${key}" is cut at " #", which starts a YAML comment; quote the value or write it as a block scalar (>)`,
      );
    }
  }
  return warnings;
}

/**
 * Why a front-matter that YAML rejected was probably rejected, when the source shows one of the
 * usual mistakes in a plain scalar: a colon followed by a space, or an opening character that
 * means something in YAML. Nothing is repaired; this only makes the report actionable.
 */
export function plainScalarHint(source: string): string | undefined {
  for (const line of source.split("\n")) {
    const match = /^([A-Za-z][\w-]*):[ \t]+(\S.*)$/.exec(line.slice(0, 2000));
    if (match === null) {
      continue;
    }
    const [, key = "", value = ""] = match;
    if (QUOTED_OR_BLOCK.test(value)) {
      continue;
    }
    if (/[[\]{}&*!%@`]/.test(value[0] ?? "")) {
      return `the value of "${key}" starts with "${value[0]}", which means something in YAML; quote the value`;
    }
    if (value.includes(": ") || value.endsWith(":")) {
      return `the value of "${key}" contains ": "; quote the value or write it as a block scalar (>)`;
    }
  }
  return undefined;
}
