---
"@skillcdn/cli": patch
"@skillcdn/core": patch
"@skillcdn/reader": patch
---

`skillcdn embed <directory>` embeds the sections of a directory's documents ahead of the first search, with the server `EMBEDDINGS_URL` and `EMBEDDINGS_MODEL` name, and keeps the vectors in the cache: a `find`, an `mcp` or a `serve` afterwards ranks by words and meaning at once. On standard error it says how many documents there are and, every fifteen seconds at the most, how many are done and about how long is left, which every command that embeds now says in place of a line per hundred documents; it exits `2` when the server failed, with what it embedded kept. While the embedding of an index goes on, a search by words and meaning says how far it is: the ranking line ends `; 123 of 380 documents embedded so far.`, and `FindRanking` and the REST `ranking` gain the optional `embedding`.
