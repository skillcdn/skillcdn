---
"@skillcdn/core": patch
"@skillcdn/serve": patch
---

An answer of a search that came without its meaning is for whoever asked, and for no cache (ADR-0096). `answeredInPart` of `@skillcdn/core` says when a ranking is of an answer in part: the words did not answer in time, the meaning did not answer where the search is by meaning as well, or the index is still being embedded; a query of identifiers ranked by its words, and a search where there is no model, are answered in full. The REST routes of `@skillcdn/serve` tell a cache to keep the answer of `find` at a pinned public address for a day only where it is in full, and answer `no-store` otherwise: an answer given while the embedder was away used to be kept for the day.
