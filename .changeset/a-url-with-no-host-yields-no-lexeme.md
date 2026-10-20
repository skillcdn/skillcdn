---
"@skillcdn/core": patch
---

A URL written without a host, as a placeholder is (`https://...`), no longer yields an empty lexeme, which PostgreSQL rejected when the vector was stored, so that a pack with such a placeholder in a document indexes again; the path of such a URL, when it has one, is a word on its own, as the parser reads it. `searchLexemes` and `queryLexemes` never answer an empty lexeme, whatever rule left it.
