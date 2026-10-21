---
"@skillcdn/core": patch
"@skillcdn/reader": patch
---

A search fuses the results of the words with the sections nearest in meaning, where the index keeps the vectors of its sections and an embedder is at hand (ADR-0064, ADR-0065): the `IndexStore` port gains an optional `searchByMeaning`, answering `MeaningMatch`es, and `ReaderDependencies` an optional `meaning`, with the embedder that embeds a query and a reranker that scores the first results before the page is cut. The two lists become one order by reciprocal rank fusion (`fuseRanks`, `RRF_K` in core), with the skill boost and the path order kept, and a document's sections the same way, a section found by meaning alone excerpted by `sectionExcerpt`. An embedder or a reranker that does not answer leaves the words to answer alone, and the result says how it was ranked: `FindResult.ranking`, one line in the rendered text and a `ranking` field in the REST body, present only where the search by meaning is at hand. Nothing changes for an index without vectors, such as the command's.
