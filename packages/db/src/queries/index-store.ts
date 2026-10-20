import type { IndexEntry, IndexStore, RepoPath, SnapshotDiagnostic } from "@skillcdn/core";
import type { Database } from "../client.js";
import { type EntryRecord, searchEntries, servedEntries } from "./entries.js";
import { getSnapshotDiagnostics, type SnapshotScope } from "./snapshots.js";

// The index of a commit as this database keeps it, behind the port the reader reads through
// (ADR-0054): the served entries in path order, and a search as `searchEntries` runs it.

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
export function createIndexStore(database: Database, scope: SnapshotScope): IndexStore {
  return {
    async entries(): Promise<readonly IndexEntry[]> {
      return (await servedEntries(database, scope)).map(entryOf);
    },
    async search(mountPath: RepoPath, lexemes: readonly string[]): Promise<readonly IndexEntry[]> {
      return (await searchEntries(database, scope, mountPath, lexemes)).map(entryOf);
    },
    diagnostics(): Promise<readonly SnapshotDiagnostic[]> {
      return getSnapshotDiagnostics(database, scope);
    },
  };
}
