---
"@skillcdn/core": minor
"@skillcdn/reader": minor
---

The reads of a mount are a package, `@skillcdn/reader`, over the `IndexStore` port that `@skillcdn/core` now defines (`IndexStore`, `ReadableIndex`, `IndexOutcome`), so that the same reads answer from an index wherever it is kept (ADR-0054). `Reader` takes a `MountContext` and the index the caller answers, and gives the results the MCP tools and the REST bodies are written from: `catalog`, `overview`, `browse`, `find`, `skill`, `file`, and the skills extension's `listSkills`, `getSkill`, `readResource` and `readDirectory`.
