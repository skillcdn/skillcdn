// Public surface of @skillcdn/client. Other workspaces import from this entry point only.

export {
  ApiError,
  type ClientOptions,
  createClient,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  type SkillCdnClient,
} from "./client.js";
export {
  MAX_SKILL_PAGES,
  type SkillPage,
  skillPages,
  type WaitOptions,
  whenIndexed,
} from "./reads.js";
