# ADR-0006: MCP SDK v2, one server instance per request

- Status: Accepted
- Date: 2026-09-21

## Context

The `api` role must be stateless: any replica answers any request, and nothing survives between two requests of one client. The endpoint URL is the address, so every request may name a different repository, ref and path. Clients in the wild speak two protocol eras: the 2026-07-28 revision, which carries everything it needs in each request, and the 2025 revisions, which open with an `initialize` handshake.

The official TypeScript SDK exists in two lines. v1 (`@modelcontextprotocol/sdk`) is in maintenance and needs a hand-built stateless transport. v2 (`@modelcontextprotocol/server`) is the stable line for the current revision.

## Decision

Build on SDK v2 and its `createMcpHandler`. The handler calls a factory for every HTTP request; the factory returns a fresh server with the fixed tool set, bound to the mount that the HTTP route resolved from the URL. The same factory serves both eras: 2025-era traffic goes through the SDK's stateless fallback, with no sessions.

Tool contracts stay in `packages/core` as plain Zod schemas and text renderers. Only `apps/server/src/mcp/` and `src/http/app.ts` import the SDK.

## Consequences

- No session affinity and no session store. A server instance lives for one request, so there is no per-client state to leak between mounts.
- Session-based features of the 2025 revisions are not offered: `GET` and `DELETE` on the endpoint answer `405`, and the server never pushes notifications. Nothing in the tool set needs them.
- Resolving the mount happens before the protocol layer, so an unknown repository or ref is an HTTP `404` at connect time rather than a failing tool call later.
- Building a server per request costs a few object allocations and schema conversions. It is negligible next to a database query, and it is what keeps the handler stateless.
- The SDK is young in this major version. It is confined to two modules, so replacing or pinning it is a contained change.
- Rejected: SDK v1 (a migration would follow within months). Rejected: one long-lived server per mount (state to evict, and affinity to get right, for no benefit to a read-only tool set).
