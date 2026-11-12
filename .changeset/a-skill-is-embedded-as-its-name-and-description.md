---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

A skill is found by meaning through what it is named and says it does (ADR-0094). Its name and description are embedded as one text of their own, `name: description`, beside the sections of its `SKILL.md`, and a search by meaning compares that vector as it compares a section's. In `@skillcdn/core`, `embeddedTextsOf` lists every text a body is embedded as, a skill's head first under `HEAD_SECTION` (`-1`), and `headTextOf` writes the head; `embeddingTextOf` and `sectionsOf` are what they were. An index in memory (`@skillcdn/reader`) compares a head for a skill and for no document that holds the same bytes. The `skillcdn` command embeds the head with the sections, and a directory embedded before gets the heads of its skills on the next run, one short text each: the vectors kept in the cache stay, and a cache file gains an optional `head` mark that an older version of the command reads past.
