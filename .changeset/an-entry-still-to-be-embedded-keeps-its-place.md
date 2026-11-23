---
"@skillcdn/core": patch
"@skillcdn/reader": patch
---

While the embedding of an index is under way, an entry it has not reached keeps the place its words give it ([ADR-0126](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0126-an-entry-still-to-be-embedded-keeps-the-place-its-words-give-it.md)).

- **A search by words and meaning no longer puts an entry that has no vector yet behind everything both lists found.** Such an entry cannot be in the list by meaning, so its place among the words now counts for both lists: a skill or a document asked for by its name stands first before it is embedded, and a directory the command is still embedding answers with the documents that hold the words, not with the ones embedded first. An index whose embedding is complete is ranked as before, and so is an entry that is never embedded.
- `fuseRanks` of `@skillcdn/core` takes `unplaced`, which says that a list could not have held a key: that list then counts the key at the best place another list gave it.
- `IndexStore` takes an optional `unembedded`, which names the bodies the embedding has still to reach; the index in memory of `@skillcdn/reader` answers it, and a store that leaves it out is searched as before.
