// Public surface of @skillcdn/db. Other workspaces import from this entry point only.
export { createDatabase, type Database, type DatabaseOptions } from "./client.js";
export { getSchemaStatus, migrateDatabase, type SchemaStatus } from "./migrate.js";
export { createBlobStore } from "./queries/blobs.js";
export {
  countEntries,
  type DirectoryListing,
  type EntryListing,
  type EntryRecord,
  findSkills,
  getEntry,
  listDirectory,
  listEntries,
  listSkillFiles,
  searchEntries,
} from "./queries/entries.js";
export {
  type CachedRef,
  deleteRepoAlias,
  findCachedRef,
  findRepoByAlias,
  type RepoAlias,
  type RepoAliasRecord,
  type RepoRecord,
  type RepoScope,
  saveCachedRef,
  saveRepository,
} from "./queries/repos.js";
export {
  claimSnapshot,
  ensureSnapshot,
  failSnapshot,
  getSnapshot,
  getSnapshotDiagnostics,
  type NewIndexEntry,
  releaseSnapshot,
  renewSnapshotLease,
  type SnapshotIndex,
  type SnapshotRecord,
  type SnapshotScope,
  type SnapshotStatus,
  writeSnapshotIndex,
} from "./queries/snapshots.js";
export {
  addUsage,
  addUsageClients,
  foldUsageClients,
  getRepoUsage,
  getUsageClientKey,
  listTopRepositories,
  type RepositoryUsage,
  type UsageClient,
  type UsageDay,
  type UsageIncrement,
  type UsageMetric,
  type UsageTotal,
  usageDayOf,
} from "./queries/usage.js";
export type { SkillFrontMatter, SnapshotDiagnostic } from "./schema.js";
