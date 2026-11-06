---
"@skillcdn/core": patch
"@skillcdn/serve": patch
"@skillcdn/cli": patch
---

A refused read of a file of a pack served from a directory, over MCP, over REST and by the command, no longer tells the reader to fetch it with a GitHub credential: the line that names the credential follows only for a private repository of a git host, which has one to ask. `MountSummary` may name the `host` of its address, which the reader's summaries and `mountSummaryOf` now do, and `accessHint` and `describeSource` read it; a summary without it is read as a git host's.
