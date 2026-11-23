---
"@skillcdn/indexer": patch
"@skillcdn/cli": patch
---

`skillcdn check` says when the document a skill is served as through the MCP skills extension is more than a tool result holds ([ADR-0125](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0125-the-document-a-skill-is-served-as-stays-whole-and-check-says-when-it-is-more-than-a-tool-result-holds.md)). A host of the extension is handed that document in one piece, with the rules above the skill and every included file in it, where the tools give the same text in pages, and a client that bounds what its model gets of one read cuts a long one.

- Under a listed skill whose document is over 24,576 bytes, the `extension:` line goes on: `extension: listed, 61390 bytes as served, in one piece: over the 24576 bytes a tool result is kept within`. A shorter document is reported as before.
- The notes count such skills among the listed (`served_large`). It is a note: the exit code is as before.

The bound is the server's own, `MCP_RESULT_MAX_BYTES` of `@skillcdn/core`, and no client's bound is compared with. What is served does not change.
