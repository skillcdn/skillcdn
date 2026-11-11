# ADR-0079: A query of identifiers alone is ranked by its words, and a heading that names its leading identifier stands first

- Status: Accepted
- Date: 2026-11-11
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) (point 5, the fusion of words and meaning) and [ADR-0069](0069-a-word-of-a-query-weighs-by-its-rarity-among-the-entries-searched.md).

## Context

Where a deployment searches by meaning, the sections nearest to the query are fused with the words' results by reciprocal rank fusion, and the first results may be reranked. That serves a question asked in other words than the document's. It fails the other kind of query an agent makes of a specification: the number of a clause, the name of a table, the identifier of a definition. An embedding model places a number near every other number and a name near every name like it, so the list by meaning is close to arbitrary, and fused in at the same weight it lifts documents that both lists hold a little of over the one document the words name first.

Measured on a pack of two long specifications of an installation (328 documents, 2,078 sections), with 704 queries made from the pack itself, the first result was the right document for 647 by words alone, for 436 by words and meaning, and for 496 with a reranker on top: clause numbers 271, 135 and 207 of 300, table names 32, 3 and 9 of 45. Re-ranking the same answers by the two rules below gave 656; either rule alone gave less (639 and 629). Questions in other words kept their first results.

## Decision

1. **A token is written as an identifier** when it holds a digit, or an upper-case letter after its first character (`maxRetries`, `ResumeGuardTimes`, `TABLE`), or is a word of kind (`table`, `figure`, `section`, `clause`, `annex`, `appendix`, `chapter`), or is the one capital letter after a word of kind (`Annex B`). A word with a capital first letter alone is a word, and a word of kind by itself names nothing.
2. **A query of at most four tokens, all identifiers, is ranked by its words.** The search by meaning and the reranker are not asked; the words' order, weighed by rarity, stands. Only when the words find nothing is the query answered by meaning, as any other.
3. **A document one of whose headings names the identifiers a query begins with stands first.** The identifiers at the head of the query, `4.2.6` of `4.2.6 Link resumption`, are held against the headings of the first ten documents the words found: a heading names them when they stand in it token for token, whatever the case and whatever punctuation stands around a token, so `4.2.6.1` does not name `4.2.6`. Those documents come first, in the words' order; the rest follows as fused, and a reranker orders only what follows them. This holds for a query of identifiers alone as well, where the heading decides between the documents the words found.
4. **The result says so in the line it already has for the ranking**: `Ranked by words alone: a query of numbers and names is matched as written.`, and `ranking.identifiers` over REST, where the search by meaning is at hand; nothing more where only words ever rank.
5. **The rules are `core`'s** (`queryIdentifiers`, `headingNames`), applied by the reader inside a mount and by the server across the packs of a deployment, so that both rank alike.

## Consequences

- A clause number, a table name and a definition name find the file that holds them first, with the search by meaning on, as they did with it off; the specification pack of the fixtures holds this for every heading, table and definition it has.
- Such a query costs no call to the embedding model and none to the reranker, and up to ten bodies read for their headings, the bodies a page of results reads anyway.
- A query written as identifiers that is in fact a question, capitals throughout, is ranked by its words when it is four tokens or fewer; it still finds what holds its words.
- The words of kind are English. A pack in another language is served by the digits and the capitals of its identifiers; a list per language waits for a pack that needs it.
- Rejected: weights in the fusion (a number by which meaning counts less changes every query to help one kind, and has to be tuned per model); asking the embedder and discarding its answer (a call and its latency for nothing); deciding by the language of the query (a clause number has none).
