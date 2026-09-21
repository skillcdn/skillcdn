// Test support: builds tar archives byte by byte, including deliberately broken ones.

export interface TarEntrySpec {
  readonly path: string;
  readonly prefix?: string;
  /** "0" file (default), "5" directory, "2" symlink, "x" pax header, "g" global header, "L" GNU long name. */
  readonly type?: string;
  readonly data?: string | Uint8Array;
  readonly linkName?: string;
  /** Overrides the size field with raw bytes, for sizes a reader must refuse. */
  readonly rawSize?: readonly number[];
}

const BLOCK = 512;
const encoder = new TextEncoder();

function writeText(block: Uint8Array, offset: number, length: number, value: string): void {
  block.set(encoder.encode(value).subarray(0, length), offset);
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  writeText(block, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

export function tarArchive(entries: readonly TarEntrySpec[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const data =
      typeof entry.data === "string"
        ? encoder.encode(entry.data)
        : (entry.data ?? new Uint8Array());
    const header = new Uint8Array(BLOCK);
    writeText(header, 0, 100, entry.path);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    if (entry.rawSize === undefined) {
      writeOctal(header, 124, 12, data.byteLength);
    } else {
      header.set(entry.rawSize, 124);
    }
    writeOctal(header, 136, 12, 0);
    writeText(header, 156, 1, entry.type ?? "0");
    writeText(header, 157, 100, entry.linkName ?? "");
    writeText(header, 257, 6, "ustar\0");
    writeText(header, 263, 2, "00");
    writeText(header, 345, 155, entry.prefix ?? "");

    header.fill(0x20, 148, 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

    blocks.push(header);
    const body = new Uint8Array(Math.ceil(data.byteLength / BLOCK) * BLOCK);
    body.set(data);
    blocks.push(body);
  }
  blocks.push(new Uint8Array(BLOCK * 2));

  const archive = new Uint8Array(blocks.reduce((total, block) => total + block.byteLength, 0));
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.byteLength;
  }
  return archive;
}

export async function* chunked(bytes: Uint8Array, chunkSize: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.subarray(offset, offset + chunkSize);
  }
}
