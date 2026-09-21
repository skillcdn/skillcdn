// Public surface of @skillcdn/core. Other workspaces import from this entry point only.
export { isAnonymouslyReadable } from "./access.js";
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
export { DomainError } from "./errors.js";
export {
  type FrontMatterError,
  type FrontMatterErrorCode,
  type FrontMatterSplit,
  MAX_FRONT_MATTER_LENGTH,
  parseFrontMatter,
  splitFrontMatter,
} from "./front-matter.js";
export { isFullCommitHash, isValidRefName, MAX_REF_LENGTH } from "./git-ref.js";
export { type MarkdownSummary, summarizeMarkdown } from "./markdown.js";
export type { BlobStore } from "./ports/blob-store.js";
export type { Clock } from "./ports/clock.js";
export {
  allowEverything,
  type EntitlementAction,
  type EntitlementDecision,
  type EntitlementQuery,
  type Entitlements,
  type IndexLimits,
} from "./ports/entitlements.js";
export {
  type GitHost,
  GitHostError,
  type GitHostErrorKind,
  type HostAccount,
  type HostRepository,
  type RepoCoordinates,
  type RepoTree,
  type TreeEntry,
} from "./ports/git-host.js";
export { discardUsage, type UsageEvent, type UsageSink } from "./ports/usage-sink.js";
export {
  baseName,
  classifyRepoFile,
  owningSkillDirectory,
  parentDirectory,
  type RepoFileKind,
  SKILL_MANIFEST_FILE,
} from "./repo-layout.js";
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
export {
  MAX_SKILL_COMPATIBILITY_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_MANIFEST_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  type ParsedSkillManifest,
  parseSkillManifest,
  type SkillManifest,
  type SkillManifestContext,
  type SkillManifestError,
  type SkillManifestErrorCode,
  type SkillManifestWarning,
  type SkillManifestWarningCode,
} from "./skill-manifest.js";
export { hasForbiddenCodePoint } from "./text-safety.js";
export {
  FIND_DEFAULT_LIMIT,
  FIND_MAX_LIMIT,
  type FindInput,
  findInputSchema,
  findTool,
  type GetInput,
  getInputSchema,
  getTool,
  MAX_QUERY_LENGTH,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LIMIT,
  type ReadFileInput,
  readFileInputSchema,
  readFileTool,
  TOOL_NAMES,
  type ToolContract,
} from "./tools/contracts.js";
export {
  INDEXING_NOTICE,
  PROVENANCE_NOTICE,
  renderFileResult,
  renderFindResult,
  renderSkillResult,
} from "./tools/render.js";
export {
  type FileResult,
  type FindItem,
  type FindResult,
  type MountSummary,
  pageOfText,
  type SkillResult,
} from "./tools/results.js";
