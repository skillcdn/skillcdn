import { createHash } from "node:crypto";
import {
  type BlobStore,
  type DocumentSection,
  type IndexEntry,
  type IndexStore,
  type MeaningMatch,
  parseSearchVector,
  type ReadableIndex,
  type RepoPath,
  rankSearchVector,
  type SearchVector,
  SKILL_RANK_BOOST,
  type SnapshotIndex,
} from "@skillcdn/core";
import { compareByteOrder, sortedByPath } from "./order.js";

// An index kept in memory (ADR-0054): what the indexer produced of a commit or a directory,
// read as the deployment reads one it keeps in PostgreSQL. A search ranks the vectors the
// indexer built, the same vectors the deployment stores, with the rank `ts_rank` computes
// (ADR-0063); which of two matches comes first may still differ where their ranks are close
// (ADR-0053).

export interface MemoryIndexOptions {
  readonly index: SnapshotIndex;
  /** The bodies the entries name by hash, as the indexer stored them. */
  readonly blobs: Pick<BlobStore, "read" | "readBytes">;
  /**
   * What a cursor binds to: left out, a digest of the entries, so that a cursor from an index of
   * other content is refused.
   */
  readonly id?: string | undefined;
  /**
   * The vectors of the sections of the bodies, by blob hash, where the person has them
   * (ADR-0064): the index then answers a search by meaning over them, exactly, as a deployment's
   * database answers one. Left out, the words answer alone.
   */
  readonly vectors?: MemoryVectors | undefined;
}

/** The vector of one section of a body, as the cache of the command keeps it. */
export interface MemorySectionVector extends DocumentSection {
  /** The section's index in the order `sectionsOf` lists them, from 0. */
  readonly section: number;
  readonly vector: Float32Array;
}

/** The vectors of the sections of each body, by the body's blob hash; nothing for a body without. */
export interface MemoryVectors {
  sectionsOf(blobSha: string): readonly MemorySectionVector[] | undefined;
}

/** Cosine similarity of two vectors of the same dimensions; 0 where either has no length. */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let at = 0; at < a.length; at += 1) {
    const x = a[at] ?? 0;
    const y = b[at] ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  const length = Math.sqrt(aa * bb);
  return length === 0 ? 0 : dot / length;
}

/** A digest of what the entries name: the same content gives the same id. */
function digestOf(index: SnapshotIndex): string {
  const hash = createHash("sha256");
  hash.update(String(index.version));
  for (const entry of index.entries) {
    hash.update(
      `${entry.path}\0${entry.blobSha}\0${entry.digest ?? ""}\0${entry.visible ? 1 : 0}\n`,
    );
  }
  return hash.digest("base64url");
}

/** Whether `path` is under `mountPath`, which the empty path makes everything. */
const underPath = (path: string, mountPath: string): boolean =>
  mountPath.length === 0 || path.startsWith(`${mountPath}/`);

export function createMemoryIndex(options: MemoryIndexOptions): ReadableIndex {
  const { index, blobs } = options;
  const served = sortedByPath(
    index.entries.filter((entry) => entry.visible),
    (entry) => entry.path,
  );
  /** The vector of every searchable entry, read from its text form on the first search and kept. */
  let vectors: ReadonlyMap<string, SearchVector> | undefined;
  const vectorsOf = (): ReadonlyMap<string, SearchVector> => {
    if (vectors === undefined) {
      const built = new Map<string, SearchVector>();
      for (const entry of served) {
        if (entry.searchable && entry.search !== undefined) {
          built.set(entry.path, parseSearchVector(entry.search));
        }
      }
      vectors = built;
    }
    return vectors;
  };

  const store: IndexStore = {
    async entries(): Promise<readonly IndexEntry[]> {
      return served;
    },
    async search(mountPath: RepoPath, lexemes: readonly string[]): Promise<readonly IndexEntry[]> {
      if (lexemes.length === 0) {
        return [];
      }
      const built = vectorsOf();
      const ranked: { entry: IndexEntry; rank: number }[] = [];
      for (const entry of served) {
        if (!underPath(entry.path, mountPath)) {
          continue;
        }
        const vector = built.get(entry.path);
        if (vector === undefined) {
          continue;
        }
        const rank = rankSearchVector(vector, lexemes);
        if (rank > 0) {
          ranked.push({ entry, rank: entry.kind === "skill" ? rank * SKILL_RANK_BOOST : rank });
        }
      }
      return ranked
        .sort((a, b) => b.rank - a.rank || compareByteOrder(a.entry.path, b.entry.path))
        .map((item) => item.entry);
    },
    async diagnostics() {
      return index.diagnostics;
    },
    ...(options.vectors === undefined
      ? {}
      : {
          async searchByMeaning(
            mountPath: RepoPath,
            vector: Float32Array,
            limit: number,
          ): Promise<readonly MeaningMatch[]> {
            // Every section of the findable entries under the mount, compared exactly, as the
            // deployment's database compares them (ADR-0064); two entries of the same bytes are
            // two results; ties by path, then section, so that the order is the same everywhere.
            const nearest: MeaningMatch[] = [];
            for (const entry of served) {
              if (!entry.searchable || !underPath(entry.path, mountPath)) {
                continue;
              }
              const sections = options.vectors?.sectionsOf(entry.blobSha);
              if (sections === undefined) {
                continue;
              }
              for (const section of sections) {
                if (section.vector.length !== vector.length) {
                  continue;
                }
                nearest.push({
                  path: entry.path,
                  section: section.section,
                  heading: section.heading,
                  offset: section.offset,
                  length: section.length,
                  similarity: cosine(section.vector, vector),
                });
              }
            }
            return nearest
              .sort(
                (a, b) =>
                  b.similarity - a.similarity ||
                  compareByteOrder(a.path, b.path) ||
                  a.section - b.section,
              )
              .slice(0, limit);
          },
        }),
  };

  return {
    id: options.id ?? digestOf(index),
    version: index.version,
    truncated: index.truncated,
    license: index.license,
    store,
    blobs,
  };
}
