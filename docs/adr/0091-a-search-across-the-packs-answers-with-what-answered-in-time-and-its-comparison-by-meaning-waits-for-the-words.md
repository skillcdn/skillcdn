# ADR-0091: A search across the packs answers with what answered in time, and its comparison by meaning waits for the words

- Status: Accepted
- Date: 2026-11-12
- Builds on [ADR-0070](0070-a-deployment-is-searched-across-every-pack-it-serves.md) (the search across packs and the time limit of its statements) and [ADR-0075](0075-a-search-across-the-packs-has-a-page-per-term-that-search-engines-may-list.md) (what is kept of an answer, and the page of a term). Supersedes point 3 of [ADR-0090](0090-a-search-across-the-packs-reads-what-is-searchable-and-an-index-of-a-table-in-use-is-built-without-holding-its-writes.md) (the words and the meaning asked at once).

## Context

ADR-0090 made the words of a search across packs cost what is searchable, and asked for the words and the meaning at once, so that an answer would take as long as the slower of the two. Its own measurement left the comparison by meaning as it was: it reads every section vector of the packs searched, about a gigabyte for 196 thousand vectors of 1,024 dimensions.

That measurement was made on a fast disk. Run again on the same database (`eval:hub`) with its reads held to 125 megabytes a second, which is nearer to what a small deployment's storage gives, four things showed.

- **Asked at once, the comparison takes the reading from the words.** With nothing in the database's memory, the match by words of a two-word query ran out of its two seconds beside the comparison, and the search answered `search.timeout`. Alone, the same match took three quarters of a second.
- **A comparison that ran out of its time was asked again by the next search**, and by every search after it. Each waited the whole limit for nothing, and the database read two seconds' worth of vectors each time.
- **The failure was one-sided.** The meaning not answering left the words to answer, which the result said. The words not answering threw away whatever the meaning had found, and the search failed.
- **The limit is one statement's, and an answer is several parts**: the list of packs, the count, the match, the embedding of the query, the comparison, the bodies read for the results, the reranking. Nothing said which of them an answer of many seconds had waited for.

## Decision

1. **The comparison by meaning is asked once the words have answered.** The query is embedded while the words are looked up, since that asks another server and nothing of the database; the comparison then follows the match. An answer takes the words and the comparison one after the other, and the words are never kept waiting by a read a thousand times their size. A query of identifiers alone is still ranked by its words (ADR-0079), and neither model is asked unless the words found nothing or did not answer.
2. **A comparison that ran out of its time rests for a minute.** Until then no search asks the embedder or the comparison: the words answer alone, at once, and the result says so as it does whenever the meaning does not answer (`ranking.meaning: false`). The first search after the minute asks again. The rest is kept in the process, takes no configuration, and is forgotten by a restart.
3. **Where the words ran out of their time and the meaning answered, the answer is the meaning's alone**, and says so: `ranking.words` is `false`, the tool's line reads `Ranked by meaning alone this time`, and the page says the same. A query of identifiers alone whose words ran out is asked by its meaning for that. Where neither answered there is nothing to show, and the search fails with `search.timeout` as before.
4. **Such an answer stands in for a failure, and is kept like one: not at all.** The process does not keep it, the response is `no-store`, and the page of its term is not one for search engines to list. The next who asks is asked for in full.
5. **An answer that took longer than a statement may says where the time went.** The log of `api` has, at info, how long each part took: `packs`, `count`, `words`, `embed`, `meaning`, `items`, `rerank`.

## Consequences

- With nothing in memory, the first search answered by its words after 3.1 seconds, where it had failed after 2.4: a quarter of a second for the list of packs, eight tenths for the words, and the comparison's two seconds, spent for nothing once. The searches of the next minute answered in 0.02 to 0.7 seconds, by words.
- One search a minute waits the limit to try the comparison again. Each try leaves more of the vectors in memory, so where they fit the meaning comes back by itself: on the database above the sixth try answered, five minutes after the first, in a second and a half. Where they do not fit it stays away, and the words go on answering at their own speed. That a comparison of every vector cannot be the answer for a deployment whose vectors outgrow its memory is still open, as ADR-0090 left it.
- An answer takes the time of the words longer than when both were asked at once: with the vectors in memory, 1.2 to 2.0 seconds on the database above where it had taken 1.2 to 1.5. The two no longer hold a connection each at the same time.
- While the comparison rests, answers by words alone are kept as answers are, for the time the deployment configures, as they are when the embedder is away.
- The longest a search waits before it fails is three limits: the count, the match and the comparison, each to its end.
- `ranking.words` is new in the answer of `GET /api/v1/search` and in what `@skillcdn/core` exports; it is there only when false. Nothing that reads the field's absence changes.
- Rejected: keeping the two at once and asking the words again when both failed (twice the wait for the one who asked, and the comparison had still taken the read); letting one search at a time try the comparison after its rest (a second state for what the minute already bounds); a configurable rest (nothing to measure it against yet); keeping an answer by meaning alone for a shorter time (it is asked for seldom, and a second try is answered in full); one deadline for the whole search (the parts after the statements are not ones a database cancels, and the log now says which to bound, if any).
