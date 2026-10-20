import { createHash } from "node:crypto";
import {
  type BlobStore,
  type IndexEntry,
  type IndexStore,
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
