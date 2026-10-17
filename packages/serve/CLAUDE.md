# packages/serve: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is the edges: the MCP surface and the address routes of the REST API, over a reader, for any app to compose (ADR-0057).

- **One surface, composed twice.** The deployment's server and the command's local server call the same `createMountServer` and `registerAddressRoutes`. What differs between them (who a request is for, what is counted, where the pages are) comes in through `mountAt`, `hooks` and `request`, never through a branch in here.
- **Nothing is decided here about who may read.** `mountAt` and the mounts given are the whole authorization; this package serves what it is handed. A local app serves everything it was given to anyone who reaches it.
- **A tool result is the text, within the budget** (ADR-0034): `replies.ts` fits every reply into the MCP response budget, and nothing else shapes what a model is given.
- **The SDK stays behind this package.** `@modelcontextprotocol/server` and Hono are imported here and in `apps/server`, and nowhere else in the workspace.
- **The specs are the contract.** `docs/specs/tools.md` and `docs/specs/rest.md` say what is served; a change here changes them in the same commit.
