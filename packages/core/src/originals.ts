import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";

// An original that is encrypted stays encrypted in the pack, and the pack never holds what
// opens it (ADR-0084): a manifest says that the originals of its scope are encrypted and by
// which key the organization knows what opens them, by its name; a check holds the files
// against that, and a password written into a front-matter is the author's to hear of before
// it is pushed.

/** What a manifest says of the originals of its scope. */
export interface OriginalsPolicy {
  /** True when the originals are kept as they were received, encrypted. */
  readonly encrypted: boolean;
  /** The name the organization knows the key by; never the key. */
  readonly keyName?: string;
}

/** A key's name: a word of letters, digits, dots, underscores and hyphens, as a file is named. */
export const KEY_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;

/** How many bytes of each end of a PDF are looked at for what says that it is encrypted. */
export const PDF_ENDS_BYTES = 1_048_576;

const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ENCRYPT = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // /Encrypt

function indexOfBytes(
  bytes: Uint8Array,
  wanted: readonly number[],
  from: number,
  to: number,
): number {
  const last = Math.min(to, bytes.length) - wanted.length;
  outer: for (let at = from; at <= last; at += 1) {
    for (let index = 0; index < wanted.length; index += 1) {
      if (bytes[at + index] !== wanted[index]) {
        continue outer;
      }
    }
    return at;
  }
  return -1;
}

const isBlank = (byte: number | undefined): boolean =>
  byte === 0x20 ||
  byte === 0x0a ||
  byte === 0x0d ||
  byte === 0x09 ||
  byte === 0x0c ||
  byte === 0x00;

/** Whether the bytes name an encryption dictionary: `/Encrypt` and then a reference to one, or one written out. */
function namesEncryption(bytes: Uint8Array): boolean {
  let at = indexOfBytes(bytes, ENCRYPT, 0, bytes.length);
  while (at >= 0) {
    let next = at + ENCRYPT.length;
    const first = bytes[next];
    // `/EncryptMetadata` and the like are other names: the name ends here, or it is not this one.
    if (isBlank(first) || first === 0x3c) {
      while (isBlank(bytes[next])) {
        next += 1;
      }
      const byte = bytes[next];
      if ((byte !== undefined && byte >= 0x30 && byte <= 0x39) || byte === 0x3c) {
        return true;
      }
    }
    at = indexOfBytes(bytes, ENCRYPT, at + ENCRYPT.length, bytes.length);
  }
  return false;
}

/**
 * Whether a PDF is encrypted, from its two ends, where its trailers and its cross-reference
 * streams stand: true when one names an encryption dictionary, false when none does, and
 * `undefined` for bytes that are not a PDF. Nothing is decrypted and nothing is parsed further:
 * the bytes are a repository's, and only looked at.
 */
export function pdfEncryption(head: Uint8Array, tail: Uint8Array): boolean | undefined {
  if (indexOfBytes(head, HEADER, 0, 1024) < 0) {
    return undefined;
  }
  return namesEncryption(head) || namesEncryption(tail);
}

/** A front-matter key that is written to hold what opens something: a password, a passphrase. */
const PASSWORD_KEY = /(?:password|passwd|passphrase)$|^pwd$/;

const normalizedKey = (key: string): string => key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

/**
 * The keys of a document's front-matter that are written to hold a password, at its top and one
 * mapping down, by their names (`password`, `pdf-password`, `originals.passphrase`): what a pack
 * must not carry, since everything of a pack is served as text to whoever reads it and stays in
 * the history of its repository. Empty for front-matter that has none or cannot be read.
 */
export function passwordFieldsOf(text: string): string[] {
  const split = splitFrontMatter(text);
  if (split.kind !== "found") {
    return [];
  }
  const parsed = parseFrontMatter(split.source);
  if (!parsed.ok) {
    return [];
  }
  const found: string[] = [];
  for (const [key, value] of parsed.value) {
    if (PASSWORD_KEY.test(normalizedKey(key))) {
      found.push(key);
    }
    if (value instanceof Map) {
      for (const inner of value.keys()) {
        if (typeof inner === "string" && PASSWORD_KEY.test(normalizedKey(inner))) {
          found.push(`${key}.${inner}`);
        }
      }
    }
  }
  return found.slice(0, 8);
}
