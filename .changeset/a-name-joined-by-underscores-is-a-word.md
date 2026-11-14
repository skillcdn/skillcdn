---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/cli": patch
---

A field or an identifier written with underscores is found as written (ADR-0100). `TIDE_RATE_C2` was read as its parts alone, which every row of the table that lists it holds; it is now a word of the search vector as a whole beside them, as a code joined by hyphens and a token joined by dots already are. And the sections of a document are ranked by how rare a word is among the sections of that document, where they were ranked by how rare it is in the pack: the name then finds the section that holds its row, where it found the first section of the table. `matchSections` of `@skillcdn/core` still takes `weights` and no longer reads them. The reading rules have a new version (`INDEX_VERSION` 18): a deployment rebuilds the index of each commit and serves the one it had meanwhile, and `skillcdn` reads a directory under the new rules at once.
