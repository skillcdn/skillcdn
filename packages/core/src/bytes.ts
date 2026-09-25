const NUL = String.fromCodePoint(0);

/** The WHATWG decoder every runtime this package runs in provides; typed here so that no platform library is needed. */
interface Utf8Decoder {
  decode(input: Uint8Array): string;
}
const { TextDecoder: Decoder } = globalThis as unknown as {
  TextDecoder: new (label: "utf-8", options: { fatal: true }) => Utf8Decoder;
};

/**
 * Bytes as text, or `undefined` when they are not text: invalid UTF-8, or a NUL, which no text
 * file contains and a database text column cannot hold. A leading byte order mark is dropped.
 */
export function decodeText(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new Decoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return text.includes(NUL) ? undefined : text;
}
