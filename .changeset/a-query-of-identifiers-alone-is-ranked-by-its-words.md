---
"@skillcdn/core": patch
"@skillcdn/reader": patch
---

A query that is identifiers alone is ranked by its words, and a document one of whose headings names the identifiers a query begins with stands first (ADR-0079). Where the search by meaning is at hand, a query of at most four tokens that each hold a digit, an upper-case letter after the first character or a word of kind (`4.2.6`, `TABLE C-2`, `ResumeGuardTimes`) is answered by the words alone, with neither model asked: fused with meaning, such a query lost its first result more often than not. `core` exports `queryIdentifiers`, `headingNames` and `isHeadedBy`; `FindRanking` and the REST `ranking` gain the optional `identifiers`, and the ranking line of a result reads `Ranked by words alone: a query of numbers and names is matched as written.`; the reader exports `HEADED_CANDIDATES`.
