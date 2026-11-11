# ADR-0078: A word joined by slashes or dots is a word beside its parts

- Status: Accepted
- Date: 2026-11-11
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) (point 4, the word rules) and [ADR-0069](0069-a-word-of-a-query-weighs-by-its-rarity-among-the-entries-searched.md) (point 5, a hyphenated code beside its parts).

## Context

The word rules cut a text as the server's parser does, and that parser reads a run joined by slashes as one file path and a run joined by dots as one host: `open/closed/held` and `ops.intake.queue` are each one word, as written. Specifications and manuals write alternatives, states and code lists exactly so, and a question asks for one of them alone. Measured on a pack of two long specifications of an installation: of the words that occur only inside such a token, one in 59 joined by slashes and one in 150 joined by dots was found by itself, against 164 of 165 joined by hyphens, which the parser already reads as a word beside its parts. In the agent sessions over that pack, one question about a row of a table whose key was written with slashes took a quarter of the characters a session read, on average, because the search never named the row and the files were read whole instead.

The rules have been ours to set since the indexer builds the vectors (ADR-0069).

## Decision

1. **A token joined by slashes is a word beside the words it joins.** The whole comes first, as written and lowercased, as before; then each part between the slashes, read as a run of its own: a word is stemmed, a stop word dropped, a hyphenated part read as a hyphenated word, a dotted part as below. A number between slashes is a word of its own, so that `4.2.6/4.2.7` is found by `4.2.7`.
2. **A token joined by dots is a word beside the words it joins**, the same way, but for the parts that are digits alone: `guide.md` is found by `guide`, `v2.1` by `v2`, and a section number or a version, `4.2.6`, stays the one word it is, since it names one thing and its digits would match every other number.
3. **A URL and an address stay what the parser makes of them**: the host with its path, the host and the path, and the address whole. They are where a thing is, not what a text says.
4. **The reading rules move to version 14**, every index is rebuilt as it is next asked for, and a pack is served from its old index meanwhile ([ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md)); the floor of the servable versions stays at 11, since the entries of every version read the same. A query is read by the same rules, so a query that is itself a joined word matches the whole and each part, weighed by rarity as any word is.

## Consequences

- A document that writes `open/closed/held` is found by `closed`, and one that writes `ops.intake.queue` by `intake`; the whole still finds it first where it is asked for whole, since the whole is the rarer word.
- A vector grows by the parts: a path adds a word per segment and a file name its stem and its extension. A document full of such names is a little longer to the rank's length normalization; on the second evaluation set one question of 180 moved from first to the page for it, and the first set did not move ([the evaluation sets' page](../../apps/server/fixtures/retrieval/README.md)).
- The word rules part from the server's parser by a second addition. The parity test holds what it held: the text form, the ranks, the stemmer and the stop words.
- Rejected: cutting such a token into its parts alone (a path, a host or a code asked for whole would match every document that holds one of its parts, as codes did before ADR-0069); keeping digits of a dotted number as words (a query for `4.2.6` would match every `4`, `2` and `6`, which the rarity weight softens and the vector still pays for); the same for URLs (a link would be found by `https`'s neighbours, `com` and `www`, in every document that links anywhere).
