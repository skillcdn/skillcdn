---
"@skillcdn/core": patch
---

A search vector stops where a `tsvector` would be full: its lexemes and positions amount to at most 1,048,575 bytes as PostgreSQL lays them out (`MAX_VECTOR_BYTES`), and the words of a document past that are left out of its vector, as those past its first 200,000 characters already were. A long document in a script read by pairs of characters, Chinese or Korean for instance, could build a vector the server rejected, which failed the indexing of its pack.
