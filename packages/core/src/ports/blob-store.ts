/**
 * File bodies, keyed by their git blob hash. Content-addressed, so one copy serves every commit,
 * ref and fork that contains the file. Bytes are stored as the repository has them; text is
 * derived from them, so that a served file is exactly what its digest says (ADR-0025).
 *
 * A hash must reach this port from a tree entry the caller is allowed to see, never from user
 * input: possession of a hash is not permission to read the content.
 */
export interface BlobStore {
  /** The body as text, when it is text: valid UTF-8 without a NUL. */
  read(hash: string): Promise<string | undefined>;
  /** The body as stored. */
  readBytes(hash: string): Promise<Uint8Array | undefined>;
  /** Idempotent: writing a hash whose bytes are already stored changes nothing. */
  write(hash: string, bytes: Uint8Array): Promise<void>;
  /** The subset of `hashes` whose bytes are not stored yet. */
  missing(hashes: readonly string[]): Promise<ReadonlySet<string>>;
}
