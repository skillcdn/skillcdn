/**
 * File bodies, keyed by their git blob hash. Content-addressed, so one copy serves every commit,
 * ref and fork that contains the file. Only UTF-8 text is stored.
 *
 * A hash must reach this port from a tree entry the caller is allowed to see, never from user
 * input: possession of a hash is not permission to read the content.
 */
export interface BlobStore {
  read(hash: string): Promise<string | undefined>;
  /** Idempotent: writing a hash that is already stored changes nothing. */
  write(hash: string, content: string): Promise<void>;
  /** The subset of `hashes` that is not stored yet. */
  missing(hashes: readonly string[]): Promise<ReadonlySet<string>>;
}
