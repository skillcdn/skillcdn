const NUL = String.fromCodePoint(0);

/**
 * Bytes as text, or `undefined` when they are not text: invalid UTF-8, or a NUL, which no text
 * file contains and the database cannot store.
 */
export function decodeText(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return text.includes(NUL) ? undefined : text;
}
