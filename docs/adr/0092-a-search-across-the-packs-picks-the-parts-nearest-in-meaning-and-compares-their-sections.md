# ADR-0092: A search across the packs picks the parts nearest in meaning and compares their sections

- Status: Accepted; in point 4, the comparison of the sections of the parts picked with their own vectors is replaced by [ADR-0103](0103-a-search-across-the-packs-reads-its-vectors-in-the-order-they-are-stored-and-compares-sections-at-half-precision.md) (copies at half precision, read in the order they are stored)
- Date: 2026-11-13
- Builds on [ADR-0064](0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md) (the vectors of sections and their key), [ADR-0065](0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md) (a change of model is a backfill), [ADR-0070](0070-a-deployment-is-searched-across-every-pack-it-serves.md) (the search across packs), [ADR-0090](0090-a-search-across-the-packs-reads-what-is-searchable-and-an-index-of-a-table-in-use-is-built-without-holding-its-writes.md) and [ADR-0091](0091-a-search-across-the-packs-answers-with-what-answered-in-time-and-its-comparison-by-meaning-waits-for-the-words.md) (what it reads, and what it answers when a part of it runs out of time); supersedes point 5 of ADR-0070, and of its point 3 the sentence on the sections nearest the query.

## Context

The search across packs compared the query with the vector of every section of every pack it covers, exactly, as a search inside one mount does (ADR-0070, point 5: "until a measurement asks for more"). That measurement came. A database holds the vectors beside their rows, four kilobytes each, and once they outgrow its memory a comparison with all of them is a read of all of them from the disk: on a test database held to two processors, two gigabytes and a limited disk, with 196 thousand vectors, it took nine to twelve seconds where the vectors were not in memory and about one where they were, against a limit of two. ADR-0091 made the search answer with what answered in time; it did not make the comparison answer.

Two things are known of what comes. The packs a deployment serves are expected to grow by an order of magnitude and more, and a comparison with every section grows with them. And the vectors are not made once: a model is replaced by a better one from time to time, after which every section is embedded again (ADR-0065), so whatever the search is built on must come back from a new set of section vectors without work of its own.

The maintainer decided (2026-11-13) what the search across packs is for: finding the pack to connect to, and the documents and skills in it that speak of a thing. Finding the passage is what the search inside a pack does, and that one stays as it is, exact over every section of the mount.

What was measured for the decision, on real vectors (the model of the base profile, 1,284 sections of 273 files, 240 questions with the file that answers each, meaning alone) and on the test database:

| How the files are found | Right file first | In the first ten |
|---|---|---|
| Every section compared (as it was) | 76.3% | 92.9% |
| The mean of every eight sections, 30 parts picked, then their sections | 75.8% | 92.5% |
| The same with 50 parts picked | 76.3% | 92.9% |
| The mean of the whole file, 30 files picked, then their sections | 76.3% | 92.5% |
| The mean of every eight sections alone, no second step | 63.8% | 88.8% |
| The first section of a file alone (its title and opening) | 29.6% | 55.8% |

No file there has more than fifteen sections, so a mean of the whole file is at its best; picked by parts of eight, twenty parts kept what thirty whole files did. On the test database the two steps below took 0.12 seconds for 39 thousand parts over the same 196 thousand sections, in memory, and read 55 thousand pages where the comparison with every section read 1.7 million.

## Decision

1. **A search across the packs finds the pack and its documents and skills, not the passage.** By meaning it picks parts of documents, and compares sections only inside what it picked. A passage deep in a long document, in a part whose other sections speak of something else, may be missed across the packs; it is found inside its pack.
2. **A part is a run of eight consecutive sections of a body, and its vector the mean of theirs.** `part_vectors` holds one row a part, keyed as a section's vector is (the blob hash, the model and its dimensions, the version of the sectioning rules) and by the part's place in the body. A short document is one part; a long one is found by the part that says a thing, not by the mean of everything it says. The vector is kept at half precision and inside the row, since every search across the packs reads every part: read so, it is half the size and costs a third of the time, and picks the same parts.
3. **Part vectors are made in the database from the section vectors, never by a model.** The slice that writes the sections of a body writes its parts in the same transaction, and so does an import; the worker's sweep makes those of sections written before, in batches, until none is left; they are dropped with their sections, when a body is no longer named and when a model is replaced. So a full embedding under a new model, which is expected from time to time, brings them along with nothing to run or to remember, and the same holds for anything else that is later derived from stored vectors.
4. **The comparison by meaning across packs is two statements under the one time limit.** The first compares the query, exactly, with the part vectors of the bodies searched, and keeps the nearest `HUB_SEARCH_PARTS` (200 unless set); the second compares it with the sections of those parts, exactly, and answers them with their entries as before. What the search answers, how it fuses with the words and what it says when a part of it runs out of time are unchanged. `HUB_SEARCH_PARTS=0` compares every section as before, and so does a database whose `vector` extension is older than 0.7.0, which has no half-precision type and so no table of parts.
5. **What is not built, and when it would be.** The first statement is exact, and grows with the parts searched: about a tenth of a second for forty thousand on the test database, so a few tenths past a hundred thousand. Before that it needs nothing. Past it, an approximate index over the part vectors, of the kind the extension's own documentation describes for a search over many vectors, takes its place for the pick, with the second statement unchanged; it is made from `part_vectors` as it stands, changes nothing public, and is to be measured then, with the share of the parts that are searched and the cost of a write into it. Dividing the tables by model or by repository is a question of a hundred million vectors, and not this one.

## Consequences

- What a search across the packs reads by meaning follows the parts, an eighth of the sections and fewer, and then at most eight sections for each part picked, whatever a deployment holds.
- A deployment that is given the table finds by meaning, across packs, only the bodies whose parts are made, until the worker's first sweep after the update has made them all, which calls no model and took 46 seconds for twenty thousand bodies on the test database; the words answer meanwhile, as they do whenever the meaning does not.
- The number of parts picked and the length of a part were set from the measurements above, which are small beside a deployment. `HUB_SEARCH_PARTS` is configuration; a change of the length is a constant and a migration that empties the table, after which the sweep fills it again.
- Storage grows by a row of two kilobytes for every eight sections.
- The search inside a pack is not touched: it compares every section of its mount, which is as large as one pack.
- Rejected: one vector for a whole file (the same on short files; a long document is then found by the mean of everything it says); the title and the description alone (measured above: the right file first for three questions in ten); a column of one bit a dimension compared before the vectors, and an approximate index over it, built now (measured, and not needed at this size once the parts are compared: they are kept as what follows when the pick itself is too slow); storing a vector once for every text that repeats (the repeats are older versions of a file, which nothing searches).
- Reading a pack through the root of a deployment stays out, as ADR-0070 rejected it; the maintainer looked at it again with this decision and kept it so, for whose instructions a model would then follow. An agent with a shell finds a pack with `skillcdn search` and reads it by its address.
