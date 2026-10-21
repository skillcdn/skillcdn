---
"@skillcdn/reader": patch
---

`createMemoryIndex` takes `vectors`, the vectors of the sections of each body by its blob hash (`MemoryVectors`, `MemorySectionVector`), and its index then answers `searchByMeaning` over them, exactly, as a deployment's database answers one (ADR-0064): a `Reader` given an embedder searches a directory by words and meaning. Left out, the words answer alone, as before.
