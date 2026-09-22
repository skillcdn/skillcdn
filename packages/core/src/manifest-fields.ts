import { hasForbiddenCodePoint } from "./text-safety.js";

// Field rules shared by the two manifests, SKILL.md and SKILLCDN.md; see docs/specs/skill-repo.md.

export const MAX_OPTIONAL_FIELD_LENGTH = 1024;
const MAX_METADATA_ENTRIES = 64;
const MAX_METADATA_KEY_LENGTH = 128;

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
