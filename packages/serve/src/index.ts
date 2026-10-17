// Public surface of @skillcdn/serve. Other workspaces import from this entry point only.

export {
  createLocalApp,
  type Listening,
  type LocalServerOptions,
  listenOn,
  localMountBody,
  mountOf,
  type StdioServer,
  serveOverStdio,
} from "./local.js";
export type { ServedMount } from "./mount.js";
export {
  browseReply,
  fileReply,
  fitsReply,
  problem,
  reply,
  searchReply,
  skillReply,
  type ToolReply,
} from "./replies.js";
export {
  type AddressRouteDependencies,
  CORS_MAX_AGE_SECONDS,
  clientAppOf,
  errorBody,
  hostFailure,
  registerAddressRoutes,
} from "./rest.js";
export {
  createMountServer,
  recordRead,
  type ServeLogger,
  SKILLS_EXTENSION,
  type ToolDependencies,
  type ToolRequest,
  type UsageHooks,
} from "./tools.js";
