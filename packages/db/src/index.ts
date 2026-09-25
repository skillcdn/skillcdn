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
  getManifest,
  getSkillsAt,
  listDirectory,
  listEntries,
  listListedSkills,
  listSkillFiles,
  listSkillResources,
  searchEntries,
  servedEntries,
} from "./queries/entries.js";
export {
  addOperatorRepository,
  listOperatorRepositories,
  OPERATOR_LIST_KINDS,
  type OperatorListKind,
  type OperatorRepository,
  type PurgeResult,
  purgeRepository,
  removeOperatorRepository,
} from "./queries/operator.js";
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
  listTopRepositories,
  type RepositoryUsage,
  type UsageClient,
  type UsageDay,
  type UsageIncrement,
  type UsageMetric,
  type UsageTotal,
  usageDayOf,
} from "./queries/usage.js";
export type { SkillFrontMatter, SnapshotDiagnostic, StoredTranslation } from "./schema.js";
