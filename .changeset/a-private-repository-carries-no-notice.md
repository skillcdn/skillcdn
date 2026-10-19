---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/serve": patch
---

A mount of a private repository carries no provenance notice (ADR-0061): the notice follows a public repository nobody vouched for, and nothing else. `MountSummary` and the reader's `MountContext` take an optional `visibility`, read as `public` when absent, and the results read from the REST API take it from the repository's `visibility`. A directory served by the command is private and verified, as before, so nothing changes for it.
