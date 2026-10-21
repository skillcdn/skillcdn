import type { IndexEntry, SnapshotDiagnostic } from "../index-entry.js";
import type { LicenseFact } from "../license.js";
import type { RepoPath } from "../repo-path.js";
import type { DocumentSection } from "../search/sections.js";
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
   * The findable entries under `mountPath` whose search vector holds any of `lexemes`, best
   * first, as `rankSearchVector` ranks them: a skill outranks a document, and ties keep path
   * order. The lexemes are a query's, read with the pack's word rules (`queryLexemes`); empty
   * for none.
   */
  search(mountPath: RepoPath, lexemes: readonly string[]): Promise<readonly IndexEntry[]>;
  /**
   * The sections of the findable entries under `mountPath` nearest in meaning to the query's
   * `vector`, best first and at most `limit` (ADR-0064). Present only where the index keeps the
   * vectors of its sections, under the model the vector was made with; a store without them
   * leaves it out, and the words answer alone.
   */
  searchByMeaning?(
    mountPath: RepoPath,
    vector: Float32Array,
    limit: number,
  ): Promise<readonly MeaningMatch[]>;
  /**
   * How far the embedding of the index for the search by meaning has come (ADR-0064), where the
   * store keeps vectors: `undefined` while nothing has embedded it. Left out by a store that
   * keeps no vectors, and by one that does not count.
   */
  embeddingProgress?(): Promise<EmbeddingProgress | undefined>;
  /** What the reading rules could not read as intended. */
  diagnostics(): Promise<readonly SnapshotDiagnostic[]>;
}

/**
 * How far the embedding of an index for the search by meaning has come (ADR-0064): complete, or
 * how many of the bodies that are to be embedded have their vectors so far.
 */
export type EmbeddingProgress =
  | { readonly status: "complete" }
  | { readonly status: "in_progress"; readonly embedded: number; readonly total: number };

/**
 * How a mount is searched right now (ADR-0064): by words alone, or by words and meaning, and
 * how far the embedding of its index has come.
 */
export interface MountSearch {
  /** Whether a search of the mount uses the vectors of its sections: some exist under the model in use. */
  readonly meaning: boolean;
  /** Where the embedding stands; `undefined` where nothing has embedded the index, or nothing counts it. */
  readonly embedding: EmbeddingProgress | undefined;
}

/** A section of an entry, as near to a query as a search by meaning found it. */
export interface MeaningMatch extends DocumentSection {
  /** The entry's repository-root path. */
  readonly path: string;
  /** The section's index in the order `sectionsOf` lists them, from 0. */
  readonly section: number;
  /** Cosine similarity to the query: 1 for the same direction, 0 for none. */
  readonly similarity: number;
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
