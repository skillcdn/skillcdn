// Public surface of @skillcdn/indexer. Other workspaces import from this entry point only.

export { type BuildIndexOptions, buildSnapshotIndex, INDEX_VERSION } from "./build-index.js";
export { type CheckOptions, checkDirectory } from "./check.js";
export { gitBlobHash, sha256Hex } from "./git-hash.js";
export {
  INDEX_LIMIT_DEFAULTS,
  INDEX_LIMIT_VARIABLES,
  type IndexLimitProblem,
  type IndexLimitVariable,
  readIndexLimits,
} from "./limits.js";
