import {
  type EmbeddingProgress,
  embeddable,
  type IndexEntry,
  type IndexStore,
  type MeaningMatch,
  meaningSearchOf,
  type RepoPath,
  type SnapshotDiagnostic,
} from "@skillcdn/core";
import type { Database } from "../client.js";
import { getSnapshotEmbedding } from "./embeddings.js";
import { type EntryRecord, searchEntries, servedEntries } from "./entries.js";
import { getSnapshotDiagnostics, type SnapshotScope } from "./snapshots.js";
import { blobsWithoutVectors, searchSectionVectors, type VectorKey } from "./vectors.js";

// The index of a commit as this database keeps it, behind the port the reader reads through
// (ADR-0054): the served entries in path order, a search as `searchEntries` runs it, and, where
// the database keeps the vectors of sections under a key, the search by meaning over them.

export interface IndexStoreOptions {
  /**
   * The key the vectors of sections are searched under (ADR-0064): the model the queries are
   * embedded with. Left out, the store answers no search by meaning, and the words answer alone.
   */
  readonly vectors?: VectorKey | undefined;
}

/** A row as the indexer wrote it: nothing of what the row is `null` for. */
function entryOf(row: EntryRecord): IndexEntry {
  return {
    path: row.path,
    kind: row.kind,
    size: row.size,
    blobSha: row.blobSha,
    skillDir: row.skillDir ?? undefined,
    name: row.name ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    frontMatter: row.frontMatter ?? undefined,
    searchable: row.searchable,
    visible: true,
    ...(row.digest === null ? {} : { digest: row.digest }),
    ...(row.servedSize === null ? {} : { servedSize: row.servedSize }),
    listed: row.listed,
    ...(row.licenseKind === null ? {} : { licenseKind: row.licenseKind }),
  };
}

/** The served entries of one snapshot, as the reader reads them. */
export function createIndexStore(
  database: Database,
  scope: SnapshotScope,
  options: IndexStoreOptions = {},
): IndexStore {
  const key = options.vectors;
  return {
    async entries(): Promise<readonly IndexEntry[]> {
      return (await servedEntries(database, scope)).map(entryOf);
    },
    async search(mountPath: RepoPath, lexemes: readonly string[]): Promise<readonly IndexEntry[]> {
      return (await searchEntries(database, scope, mountPath, lexemes)).map(entryOf);
    },
    ...(key === undefined
      ? {}
      : {
          async searchByMeaning(
            mountPath: RepoPath,
            vector: Float32Array,
            limit: number,
          ): Promise<readonly MeaningMatch[]> {
            const matches = await searchSectionVectors(
              database,
              scope,
              mountPath,
              key,
              vector,
              limit,
            );
            return matches.map(({ path, section, heading, offset, length, similarity }) => ({
              path,
              section,
              heading,
              offset,
              length,
              similarity,
            }));
          },
          async embeddingProgress(): Promise<EmbeddingProgress | undefined> {
            const record = await getSnapshotEmbedding(database, scope, key);
            if (record === undefined) {
              return undefined;
            }
            if (record.completedAt != null) {
              return { status: "complete" };
            }
            // Counted as the worker counts what is left (ADR-0064): the findable documents whose
            // manifest does not keep them to the words, once each body, less those with vectors.
            const entries = await servedEntries(database, scope);
            const allowed = meaningSearchOf(entries);
            const wanted = new Set<string>();
            for (const entry of entries) {
              if (embeddable(entry) && allowed(entry.path)) {
                wanted.add(entry.blobSha);
              }
            }
            const missing = await blobsWithoutVectors(database, key, wanted);
            return {
              status: "in_progress",
              embedded: wanted.size - missing.size,
              total: wanted.size,
            };
          },
        }),
    diagnostics(): Promise<readonly SnapshotDiagnostic[]> {
      return getSnapshotDiagnostics(database, scope);
    },
  };
}
