// Public surface of @skillcdn/reader. Other workspaces import from this entry point only.

export { ReaderInputError } from "./continuation.js";
export { createMemoryIndex, type MemoryIndexOptions } from "./memory-index.js";
export type { MountContext } from "./mount.js";
export { compareByteOrder } from "./order.js";
export {
  BodyUnavailableError,
  MEANING_SECTION_CANDIDATES,
  RERANK_CANDIDATES,
  Reader,
  type ReaderDependencies,
  type ReaderMeaning,
  type Resource,
  type ResourceEntry,
  type SkillEntry,
  type SkillsPage,
} from "./reader.js";
