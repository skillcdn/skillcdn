---
"@skillcdn/core": patch
---

A word of 2047 bytes is no lexeme: PostgreSQL ignores a word of that length when it parses text, and rejected one in a stored vector, which failed the indexing of a pack whose text held one. `MAX_LEXEME_BYTES` is 2046.
