# ADR-0103: A search across the packs reads its vectors in the order they are stored, and compares sections at half precision

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0092](0092-a-search-across-the-packs-picks-the-parts-nearest-in-meaning-and-compares-their-sections.md) (the parts picked first, their sections compared after, under one time limit; point 3, what is derived from stored vectors, stands) and [ADR-0091](0091-a-search-across-the-packs-answers-with-what-answered-in-time-and-its-comparison-by-meaning-waits-for-the-words.md) (what a search answers when a part of it runs out of time). Replaces, in point 4 of ADR-0092, that the second statement compares the sections of the parts picked with their own vectors.

## Context

The first search across the packs after a deployment had been idle for a while ran out of its time in the comparison by meaning, and the search answered by its words alone for a minute after it, or with `search.timeout` where its words had run out as well. Searched again with its pages in memory, the same comparison took a tenth of a second.

Measured on a test database held to two processors, two gigabytes of memory and reads of 125 megabytes a second, filled to the shape of a deployment (700 packs served, 20 thousand findable entries in the commits served and fourteen times as many in the commits kept beside them, 196 thousand section vectors of 1,024 dimensions, 39 thousand parts), with nothing in memory:

| The comparison by meaning | Nothing in memory | In memory |
|---|---|---|
| The pick of the parts | 3,562 ms, 13,766 pages read | 70 ms |
| The sections of the parts picked | 1,112 ms, 3,653 pages read | 15 ms |

Neither statement read much. They read it in the wrong order.

- **The pick read every part of the bodies searched through the primary key**, in the order of the bodies' hashes, since the planner cannot tell how many bodies the array it is given names and expects a few. Each page was somewhere else than the one before, and each was waited for alone: a quarter of a millisecond a page here, the whole table one page at a time.
- **The sections of a part were read one vector at a time.** A section's vector, four kilobytes, lies beside its row, and the sections of two hundred parts were two thousand reads from wherever each lay: 860 of the 1,112 milliseconds.

## Decision

1. **The two statements of the comparison read their tables in the order they are stored.** They run without a plain index scan (`enable_indexscan` off for their transaction): the planner marks the pages it needs from the index and reads them in order, which the database reads ahead of. Nothing else in the search is told how to read.
2. **The sections of the parts picked are compared at half precision, from copies kept inside their rows.** `section_halves` holds each section's vector as `halfvec`, keyed as `section_vectors` is, with the vector in the row (`STORAGE MAIN`): the sections of a part are a few pages, written together. The copies are derived from the stored vectors as the parts are (ADR-0092, point 3): made in the same transaction as the parts of a body, made by the sweep for what was embedded before, dropped with the vectors they were made from, never by a model. A section's vector under a key does not change, so a copy is never made again.
3. **The heading, the offset and the length are read for the sections answered alone**, from their own rows, after the order is decided.
4. **A part whose sections are not all copied yet is compared with its sections' own vectors**, as on a database the sweep has not been through since it was given the table, so that an answer that says it is by meaning has looked. Which parts those are is told by the count of sections each part holds.

## Consequences

- On the database above, with nothing in memory, the comparison by meaning takes 1.1 to 1.2 seconds after the words, and 1.3 asked alone, as where the words ran out first: the pick 0.9 to 1.0 seconds and the sections 0.2. With its pages in memory it takes what it did, about a tenth of a second. The search inside a pack is not touched.
- Half precision is what the parts are compared at already. It moves a distance by at most 3.5 in a hundred thousand: on the database above, for five queries, the first fifty sections were the same fifty at either precision, and in three of the five two neighbours less than that apart changed places. Random vectors crowd their distances together, so a model's are apart by more. An answer across the packs is fused by the order of its results, not by their distances, and a search inside a pack still compares the sections' own vectors.
- Storage grows by a row of about two and a half kilobytes for every section, beside the four of the section's own vector. A model with fewer dimensions takes less.
- After the update that brings this, the first sweep copies every section embedded before, without calling the model: 82 seconds for 196 thousand sections on the database above. Until it has, the parts it has not reached are compared as before, with nothing missed.
- The words of a search asked after a deployment was idle are not changed by this. Their count still reads the row of every entry that holds a word, in whatever commit, as ADR-0098 left it, and on the database above it takes 1.9 seconds with nothing in memory.
- Rejected: an approximate index over the parts (what was slow is how the pages were read, not how many; ADR-0092, point 5, still says when it is to be measured); keeping the sections' own vectors in their rows (one vector of four kilobytes a page, which doubles the table the search inside a pack reads); picking fewer parts (the measurement that set two hundred, `HUB_SEARCH_PARTS`, stands); the heading and the offsets copied beside the vectors (a second copy of what fifty reads of the rows answered give); a statement that compares the copies and leaves out the parts without them (an answer by meaning that had not looked, for as long as the sweep takes).
