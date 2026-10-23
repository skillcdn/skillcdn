---
"@skillcdn/core": patch
"@skillcdn/serve": patch
"@skillcdn/client": patch
---

A deployment is searched across every public pack it serves. `@skillcdn/core` gains the result of such a search (`HubResult`, `HubItem`), its text for a model (`renderHubResult`, `renderHubInstructions`), the `search_packs` tool contract, the REST body and schema of `GET /api/v1/search` (`hubBody`, `restSearchSchema`, `hubResultOf`) and the manifest's `search.hub` field, which keeps a repository out of that search; `@skillcdn/serve` gains `createHubServer`, the MCP server of a deployment's root with the one tool, over a search a deployment provides; `@skillcdn/client` gains `search(query, limit)`.
