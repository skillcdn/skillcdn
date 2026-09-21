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
