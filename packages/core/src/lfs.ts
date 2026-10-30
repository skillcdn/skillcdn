// A file kept in Git LFS is, in the repository, a pointer: a few lines that name the object the
// real file is, by its hash and its size. A read of the pointer is not a read of the file
// (ADR-0077): the reader recognizes one and sends the reader to where the host serves the file.

/** What a Git LFS pointer says of the file it stands for. */
export interface LfsPointer {
  /** The SHA-256 of the file, in hex. */
  readonly oid: string;
  /** The bytes of the file. */
  readonly size: number;
}

/** The pointer formats Git LFS has written, by the URL of the specification each names. */
const POINTER_VERSIONS = [
  "https://git-lfs.github.com/spec/v1",
  "https://hawser.github.com/spec/v1",
];
/**
 * A pointer is small by specification; anything longer is a file that happens to start like one,
 * and a file of a binary kind that is larger is the file itself, which a reader need not fetch
 * to know.
 */
export const MAX_LFS_POINTER_LENGTH = 1024;
const MAX_POINTER_LENGTH = MAX_LFS_POINTER_LENGTH;

/**
 * The Git LFS pointer `text` is, or `undefined` when it is not one: the first line names the
 * specification, and the lines after it carry `oid sha256:<hex>` and `size <bytes>`, as the
 * specification writes them.
 */
export function parseLfsPointer(text: string): LfsPointer | undefined {
  if (text.length > MAX_POINTER_LENGTH || !text.startsWith("version ")) {
    return undefined;
  }
  const lines = text.split("\n");
  const version = lines[0]?.slice("version ".length).trim();
  if (version === undefined || !POINTER_VERSIONS.includes(version)) {
    return undefined;
  }
  let oid: string | undefined;
  let size: number | undefined;
  for (const line of lines.slice(1)) {
    const hash = /^oid sha256:([0-9a-f]{64})\s*$/.exec(line);
    if (hash?.[1] !== undefined) {
      oid = hash[1];
      continue;
    }
    const bytes = /^size ([0-9]{1,15})\s*$/.exec(line);
    if (bytes?.[1] !== undefined) {
      size = Number(bytes[1]);
    }
  }
  return oid === undefined || size === undefined ? undefined : { oid, size };
}
