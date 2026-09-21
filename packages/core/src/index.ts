// Public surface of @skillcdn/core. Other workspaces import from this entry point only.
export {
  type Address,
  type AddressError,
  type AddressErrorCode,
  type AddressRef,
  formatAddress,
  GIT_HOST_KEYS,
  type GitHostKey,
  isPinnedAddress,
  MAX_ADDRESS_LENGTH,
  parseAddress,
} from "./address.js";
export { isFullCommitHash, isValidRefName, MAX_REF_LENGTH } from "./git-ref.js";
export {
  isWithinRepoPath,
  joinRepoPath,
  MAX_REPO_PATH_LENGTH,
  parseRepoPath,
  type RepoPath,
  type RepoPathError,
  type RepoPathErrorCode,
  ROOT_PATH,
  relativeRepoPath,
} from "./repo-path.js";
export { err, ok, type Result } from "./result.js";
export { hasForbiddenCodePoint } from "./text-safety.js";
