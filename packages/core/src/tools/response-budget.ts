/** Bounds the complete MCP result, including text and structured representations. */
export const MCP_RESULT_MAX_BYTES = 24 * 1024;
export const BROWSE_DESCRIPTION_MAX_LENGTH = 240;
export const SEARCH_DESCRIPTION_MAX_LENGTH = 360;

/** Exact UTF-8 size after JSON escaping; callers pass a serializable tool result. */
export function serializedResultBytes(value: object): number {
  const json = JSON.stringify(value);
  let bytes = 0;
  for (const character of json) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Discovery summaries are single-line hints, never a replacement for source content. */
export function compactSummary(text: string, length: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  if (length < 1) return "";
  let end = length - 1;
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${flat.slice(0, end)}…`;
}
