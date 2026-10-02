# ADR-0034: A tool result is the text written for the model, carried once

- Status: Accepted
- Date: 2026-10-02
- Supersedes the structured data of point 2 of ADR-0022 and the second representation bounded by point 2 of ADR-0023; restores point 3 of ADR-0012 for the tools.

## Context

Since [ADR-0022](0022-repository-paths-and-progressive-skill-loading.md) every tool result has carried its content twice: as text written for the model, and as `structuredContent`, the same result as data. [ADR-0023](0023-optional-introductions-and-explicit-publication.md) bounded the serialized result, both copies included, to 24 KiB. For `load_skill` and `read_repo_file` the copies are the content itself, so a page held under 10 KiB of a skill whose reader admits 16 KiB: a skill of 12 KB took two calls, and its first page named five of its 53 files.

What a client passes to its model decides what the second copy is worth, and the protocol leaves that to the client: `content` is required, `structuredContent` is optional, and a tool that returns structured content is asked to put it in a text block as well. Claude Code (2.1.201 to 2.1.285) passes the serialized `structuredContent` to its model and drops every text block when both are present, so there the text this server writes for the model, provenance notice included, never arrived. Clients that pass both pay for both. Nothing needs the structured copy: no tool declares an `outputSchema`, and the REST API serves the same results as JSON.

## Decision

1. **A tool result is the text.** `browse_repo`, `search_repo`, `load_skill` and `read_repo_file` return one text block and no `structuredContent`; so do the indexing answer and errors. The text, laid out as the [tools spec](../specs/tools.md) says, is the contract, and tests read it.
2. **The budget stays at 24 KiB** over the serialized result. A `load_skill` page carries the reader's full 16 KiB of context, and its first page names the skill's supporting files up to a byte bound instead of five, pointing at `browse_repo` for the rest.
3. **REST is the typed interface.** Programs and the web UI read the same results as JSON from the [REST API](../specs/rest.md), which does not change.

## Consequences

- Every client passes the same text to its model, and the provenance notice reaches the model everywhere.
- A skill of ordinary size loads in one call; a long reference reads in half the pages; the tokens a page costs are spent once.
- The MCP result shape changes without a compatibility period, the explicit exception of ADR-0022: a client that read `structuredContent` reads the text or REST instead. The skills extension is untouched.
- Rejected: raising the budget so that both copies fit (double the tokens where both are passed, and still no notice where only the data is passed); a structured copy without the content (a model that gets only the data would get no skill).
