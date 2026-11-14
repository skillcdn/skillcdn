# ADR-0098: The words of a search across the packs are narrowed as they are read, and a vector is unpacked once

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0090](0090-a-search-across-the-packs-reads-what-is-searchable-and-an-index-of-a-table-in-use-is-built-without-holding-its-writes.md) (a word is looked up in the index of the vectors and then narrowed to the snapshots searched) and [ADR-0091](0091-a-search-across-the-packs-answers-with-what-answered-in-time-and-its-comparison-by-meaning-waits-for-the-words.md) (the words answer first). It replaces how ADR-0090 narrows what the index finds: by the ids of every entry that holds a word, handed on as a whole.

## Context

Once the comparison by meaning had its two steps (ADR-0092), most of what a search across the packs waited for was its words: the count of the entries that hold each word, and the match that ranks them. ADR-0090 had settled their shape. A word is looked up in the index of the search vectors, where the planner is kept from expecting it in many entries, and the entries found are handed on as a whole, a materialized set for the count and an array of ids for the match, which no later condition is pushed into; the snapshots searched are named afterwards.

Read on a deployment's own packs with `explain (analyze, buffers)`, the two statements spent their time in two places.

- **Most of what the index finds is turned away, after it was read twice.** The index of the vectors holds every commit a deployment keeps: the one a ref is served from, the ones kept from before, and the repositories no search covers. For a question of several common words, fewer than a tenth of the entries that held one were of the snapshots searched. The match found the rest by their ids all the same, each a look into the primary key and a second read of its row, to turn it away there. The count wrote every one of them, once a word, to a set on disk before it narrowed them.
- **The rank unpacks a vector once for every word.** A search vector is kept apart from its row. Whatever names the column fetches it again, and the weighed rank (ADR-0069) names it once a word: a question of ten words fetched and unpacked each vector ten times.

Measured on a database filled to a deployment's shape by `eval:hub` (400 repositories, 320 thousand entries, 11,616 searchable entries in the commits served and as many in the commits kept from before), with the pages read as the number to hold on to:

| The match (`words`) | As it was | As it is |
|---|---|---|
| A rare word | 4 ms, 13 pages | 4 ms, 9 pages |
| The commonest word | 81 ms, 45,343 pages, 45,278 rows read | 78 ms, 42,471 pages, 22,639 rows |
| Four common words | 171 ms, 167,572 pages | 88 ms, 42,495 pages |
| Ten common words | 331 ms, 412,053 pages | 116 ms, 42,566 pages |

The count read the same pages either way (6,945 for the four words) and took 31 ms where it had taken 47.

Two ways that look simpler were measured and are worse.

- **Everything beside the words in the same read.** With the snapshots and what makes an entry findable written beside the word, the planner took the index of the findable entries and tested the vector of every entry it found there, whatever the word: a rare word cost 45 ms and 41,800 pages where it had cost 4 ms and 13. It is the plan ADR-0090 was written against, reached from the other side.
- **A concatenation with an empty vector as the copy.** `search || ''` unpacks a vector once as well, and rebuilds it: for the 11,616 entries, 150 ms where the copy below takes 60, and slower than ranking the stored vector until a question has five words.

## Decision

1. **The read of the index stands alone, and what it hands on is narrowed at once.** The comparison with the words is the one condition of its read, behind an `offset 0` that the planner pushes nothing into, so the index of the vectors is the only one it can take. The rows it hands on are tested for their snapshot and for being visible as they pass, on the row already in hand. No entry is read a second time to be turned away, and nothing is written to disk on the way.
2. **A vector is unpacked once a row, by a copy that changes nothing.** The entries kept hand on `setweight(search, 'D', '{}')`, the vector with a weight set on the lexemes of an empty list, behind a second `offset 0` that keeps the planner from writing the column back into every use. The rank of every word reads that copy.
3. **The word still reaches the comparison as a value the planner does not look into**, as ADR-0090 has it, and the counts stay exact.
4. **The count and the match stay two statements.** Each reads the entries that hold a word once; the count reads no vector at all.

## Consequences

- A question of several words costs the match about one read of each entry that holds a word and one unpacking of each entry kept, where it cost two reads and as many unpackings as words. What the count costs falls by what it wrote to disk.
- A search still reads the row of every entry that holds a word, in whatever commit: the index of the vectors does not know which commit is served, so what a search costs still follows, by that one read, what a deployment keeps beside what it searches, the entries of repositories that are not public among them. Nothing of those is shown or counted. An index that knows the snapshot would end it; whether it is worth what it costs every write is to be measured on a deployment before it is built.
- A search asked after a deployment was idle still reads its pages from disk once. This makes them fewer for the match and no fewer for the count.
- The query builder leaves an offset of the number 0 out of what it writes; the statements hand it the text (`FENCE`). A read written without it is ranked on the stored vector again, and a test holds what the match reads (`readHubStatements`: the entries that hold a word, once, through the index of the vectors).
- Rejected: one statement for the count and the match (the weights of the rank are made of the counts, so the rank would move into the process or the weights into SQL, a second place for one rule). Rejected: a count over the unpacked vectors of the entries kept (fewer rows on a deployment with much beside what it searches, and every vector unpacked for a count that needs none where there is little).
