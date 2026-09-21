// A reader for the tar archives a git host produces: ustar entries with pax extended headers.
// Nothing is ever written to disk, and entries are skipped unless the caller asks for them.

const BLOCK = 512;
/** Extended headers hold a path or two. Anything larger is not a header we want to buffer. */
const MAX_EXTENDED_HEADER_BYTES = 65_536;

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarError";
  }
}

export interface TarFile {
  /** The entry's path exactly as the archive spells it. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Hands out exact byte counts from a stream of arbitrarily sized chunks. */
class ByteSource {
  readonly #chunks: AsyncIterator<Uint8Array>;
  #current: Uint8Array = new Uint8Array();
  #offset = 0;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.#chunks = source[Symbol.asyncIterator]();
  }

  async #refill(): Promise<boolean> {
    while (this.#offset >= this.#current.byteLength) {
      const next = await this.#chunks.next();
      if (next.done === true) {
        return false;
      }
      this.#current = next.value;
      this.#offset = 0;
    }
    return true;
  }

  /** Exactly `length` bytes, or `undefined` when the stream ends first. */
  async read(length: number): Promise<Uint8Array | undefined> {
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      if (!(await this.#refill())) {
        return undefined;
      }
      const take = Math.min(length - filled, this.#current.byteLength - this.#offset);
      out.set(this.#current.subarray(this.#offset, this.#offset + take), filled);
      this.#offset += take;
      filled += take;
    }
    return out;
  }

  /** Discards `length` bytes without copying them. False when the stream ends first. */
  async skip(length: number): Promise<boolean> {
    let left = length;
    while (left > 0) {
      if (!(await this.#refill())) {
        return false;
      }
      const take = Math.min(left, this.#current.byteLength - this.#offset);
      this.#offset += take;
      left -= take;
    }
    return true;
  }

  async close(): Promise<void> {
    await this.#chunks.return?.();
  }
}

const decoder = new TextDecoder("utf-8");

function text(block: Uint8Array, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return decoder.decode(end < 0 ? field : field.subarray(0, end));
}

function octal(block: Uint8Array, start: number, length: number): number {
  // A set high bit announces a binary size, which only files of 8 GiB and more need.
  if (((block[start] ?? 0) & 0x80) !== 0) {
    throw new TarError("entry is too large");
  }
  const digits = text(block, start, length).trim();
  if (digits.length === 0) {
    return 0;
  }
  if (!/^[0-7]+$/.test(digits)) {
    throw new TarError("malformed number in a header");
  }
  return Number.parseInt(digits, 8);
}

function checksumMatches(block: Uint8Array): boolean {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    // The checksum field itself counts as eight spaces.
    sum += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  }
  return sum === octal(block, 148, 8);
}

/** The records of a pax extended header: `<length> <key>=<value>\n`, repeated. */
function paxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let position = 0;
  while (position < data.byteLength) {
    const space = data.indexOf(0x20, position);
    if (space < 0) {
      break;
    }
    const length = Number.parseInt(decoder.decode(data.subarray(position, space)), 10);
    if (
      !Number.isInteger(length) ||
      length <= space - position ||
      position + length > data.byteLength
    ) {
      throw new TarError("malformed extended header");
    }
    const record = decoder.decode(data.subarray(space + 1, position + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) {
      records.set(record.slice(0, equals), record.slice(equals + 1));
    }
    position += length;
  }
  return records;
}

const padded = (size: number): number => Math.ceil(size / BLOCK) * BLOCK;

/**
 * Yields the regular files of a tar stream that `wants` accepts, in archive order. Everything
 * else is skipped without being buffered. Throws {@link TarError} on a corrupt archive; a stream
 * that simply ends early ends the iteration.
 */
export async function* readTar(
  source: AsyncIterable<Uint8Array>,
  wants: (path: string, size: number) => boolean,
): AsyncGenerator<TarFile> {
  const bytes = new ByteSource(source);
  let nextPath: string | undefined;
  try {
    while (true) {
      const header = await bytes.read(BLOCK);
      // Archives end with zero blocks; a truncated one just stops.
      if (header === undefined || header.every((byte) => byte === 0)) {
        return;
      }
      if (!checksumMatches(header)) {
        throw new TarError("header checksum does not match");
      }
      const size = octal(header, 124, 12);
      const type = String.fromCodePoint(header[156] ?? 0);

      if (type === "x" || type === "L") {
        if (size > MAX_EXTENDED_HEADER_BYTES) {
          throw new TarError("extended header is too large");
        }
        const data = await bytes.read(padded(size));
        if (data === undefined) {
          return;
        }
        nextPath =
          type === "x"
            ? (paxRecords(data.subarray(0, size)).get("path") ?? nextPath)
            : text(data, 0, size);
        continue;
      }

      const prefix = text(header, 345, 155);
      const name = text(header, 0, 100);
      const path = nextPath ?? (prefix.length > 0 ? `${prefix}/${name}` : name);
      nextPath = undefined;

      const isFile = type === "0" || type === "\0" || type === "7";
      if (isFile && wants(path, size)) {
        const data = await bytes.read(padded(size));
        if (data === undefined) {
          return;
        }
        yield { path, bytes: data.subarray(0, size) };
      } else if (!(await bytes.skip(padded(size)))) {
        return;
      }
    }
  } finally {
    await bytes.close();
  }
}
