# ADR-0096: An answer its meaning did not reach is kept by no cache

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0075](0075-a-search-across-the-packs-has-a-page-per-term-that-search-engines-may-list.md) (the answer of a search is kept and shared) and [ADR-0091](0091-a-search-across-the-packs-answers-with-what-answered-in-time-and-its-comparison-by-meaning-waits-for-the-words.md) (a search answers with what answered in time). It replaces one consequence of ADR-0091: that answers by words alone are kept as answers are while the comparison rests, and when the embedder is away.

## Context

A search across the packs answers with what answered in time (ADR-0091). Where the words ran out of their time, the answer is the meaning's alone and is kept by nothing. Where the meaning did not answer, the embedder away or the comparison out of its time and resting for a minute, the words answer alone, the result says so, and that answer was kept like any other: in the process and in a cache in front of the deployment, for the time the deployment configures, five minutes unless it says otherwise, and a cache in front may serve it for as long again while it asks anew.

So one comparison that ran out of its time left answers by words alone standing for minutes after the meaning was back, and for exactly the questions that had just been asked: the same question, asked again once the rest was over, was answered from what was kept, while a question nobody had asked was answered by words and meaning. The two answers differ by much. On the packs and the questions of [ADR-0095](0095-a-skill-is-boosted-over-a-document-once-where-the-results-are-put-in-one-order.md), the skill asked for stands first for half as many questions by words alone as by words and meaning.

The same holds inside a mount, in one place. The answer of `find` at a public address pinned to a commit is told to caches for a day, since the commit never changes. An answer given while the embedder was away, or while the commit's index was still being embedded, is not the commit's answer: it is what could be had at that moment.

## Decision

1. **An answer is in part where its ranking says so**, and one rule says it (`answeredInPart` of `@skillcdn/core`): the words did not answer in time, or the meaning did not answer where the search is by meaning as well, or the index is still being embedded. A query of identifiers alone, ranked by its words on purpose (ADR-0079), is answered in full, and so is every search where there is no model to ask.
2. **An answer in part is for whoever asked, and for no cache.** The search across packs keeps nothing of it in the process and answers `no-store`, on `GET /api/v1/search` and on the page of the term, as it already did for an answer without its words. The next who asks the same is asked for again.
3. **The answer of `find` at a pinned public address is told to caches for a day only where it is in full**; in part, it is `no-store` like the answer of any other address.
4. **The page of a term whose answer came by words alone stays one a search engine may list.** What it shows is what the words find; only an answer without its words is not the page to list (ADR-0091).

## Consequences

- A question asked while the meaning was away is answered by words and meaning as soon as the meaning is back, by the process and by a cache in front alike.
- While a deployment's model is away, no answer of the search across packs is kept, and every search reads the database. What protects the database then is what ADR-0075 already has: the same question asked at once is answered once, only so many searches run at once, and the statements of the words are the cheap ones, the comparison being the one that is not asked.
- A deployment without a model, and a query of identifiers, are kept as before: nothing about them is less than the search has to give.
- `answeredInPart` is new in what `@skillcdn/core` exports. No answer changes its shape.
- Rejected: keeping an answer by words alone for the minute the comparison rests (an answer of the rest's last seconds would outlive it by the whole minute, and a second clock would be kept for what a search by words costs). Rejected: marking the page of such an answer as not to be listed (it would take a term's page out of a search engine's list for one slow comparison).
