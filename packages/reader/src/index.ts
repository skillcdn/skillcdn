// Public surface of @skillcdn/reader. Other workspaces import from this entry point only.

export { ReaderInputError } from "./continuation.js";
export type { MountContext } from "./mount.js";
export { compareByteOrder } from "./order.js";
export {
  BodyUnavailableError,
  Reader,
  type ReaderDependencies,
  type Resource,
  type ResourceEntry,
  type SkillEntry,
  type SkillsPage,
} from "./reader.js";
