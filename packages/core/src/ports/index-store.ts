import type { IndexEntry, SnapshotDiagnostic } from "../index-entry.js";
import type { LicenseFact } from "../license.js";
import type { RepoPath } from "../repo-path.js";
import type { IndexNotReady } from "../tools/reads.js";
import type { BlobStore } from "./blob-store.js";

/**
 * The index of one commit, wherever it is kept (ADR-0054): what the reads of a mount are
 * answered from. A deployment keeps it in PostgreSQL; the command keeps one in memory, read
 * from a directory. Everything an adapter answers is the indexer's data, in the order the
 * indexer wrote it: the served entries by path, in byte order.
 */
export interface IndexStore {
  /** Every served entry of the commit (`visible`), in byte order of path. */
  entries(): Promise<readonly IndexEntry[]>;
  /**
   * The findable entries under `mountPath` that the words of `query` match, best first, as the
   * deployment searches them (`searchLexemes` and `rankSearchVector` say how): a skill outranks
   * a document, and ties keep path order. Empty for a query without a usable word.
   */
  search(mountPath: RepoPath, query: string): Promise<readonly IndexEntry[]>;
  /** What the reading rules could not read as intended. */
  diagnostics(): Promise<readonly SnapshotDiagnostic[]>;
}

/** An index ready to be read: where it is kept, and what is known of it as a whole. */
export interface ReadableIndex {
  /** What a cursor binds to: changes whenever the index does, so that a cursor of another index is refused. */
  readonly id: string;
  /** The version of the reading rules that built it. */
  readonly version: number;
  /** True when the commit was too large to index completely. */
  readonly truncated: boolean;
  /** The license that governs the repository outside its skills (ADR-0026). */
  readonly license: LicenseFact;
  readonly store: IndexStore;
  /** The bodies the entries name by hash. */
  readonly blobs: Pick<BlobStore, "read" | "readBytes">;
}

/** The index of a mount's commit, or why there is none to read yet. */
export type IndexOutcome =
  | { readonly status: "ready"; readonly index: ReadableIndex }
  | IndexNotReady;
