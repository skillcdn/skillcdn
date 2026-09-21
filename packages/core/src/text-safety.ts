/**
 * Code points that never belong in a name we accept, store or display: control characters, and
 * invisible or direction-changing characters that make one string look like another.
 */
function isForbiddenCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f || // C0 controls
    (codePoint >= 0x7f && codePoint <= 0x9f) || // DEL and C1 controls
    (codePoint >= 0x200b && codePoint <= 0x200f) || // zero-width characters, LRM, RLM
    (codePoint >= 0x2028 && codePoint <= 0x202e) || // line and paragraph separators, bidi embeddings
    (codePoint >= 0x2060 && codePoint <= 0x2069) || // word joiner, invisible operators, bidi isolates
    codePoint === 0xfeff // byte order mark
  );
}

/** True when the string is malformed UTF-16 or contains a forbidden code point. Linear in the input. */
export function hasForbiddenCodePoint(value: string): boolean {
  if (!value.isWellFormed()) {
    return true;
  }
  for (const character of value) {
    if (isForbiddenCodePoint(character.codePointAt(0) ?? 0)) {
      return true;
    }
  }
  return false;
}
