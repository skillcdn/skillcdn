---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

Each word of a query weighs by its rarity among the entries searched: a code, a number or a name that few documents hold decides the order, a word every document repeats decides next to nothing, and the sections of a document are ranked with the same weights. `rankSearchVector` and `matchSections` take the weights, `queryWeights` makes them from how many entries hold each word, and the `IndexStore` port gains `frequencies(path, lexemes)`, which the memory index answers; a store that does not count leaves it out and ranks as before. A match in a name now counts twice a match in the body, no more (`SEARCH_WEIGHTS` 1.0, 0.85, 0.7, 0.5 for the name, the description, the path and the body). A hyphenated code with a digit part, or across scripts (`OIW-PV-120`, `6635-81-302-5518`, `서돌-4`), is a word of the search vector beside its parts, so that the code finds the one document that holds it; the reading rules are at version 12 for it, and a deployment rebuilds its indexes as they are next asked for.
