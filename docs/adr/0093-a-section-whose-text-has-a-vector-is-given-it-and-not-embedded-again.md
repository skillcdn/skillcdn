# ADR-0093: A section whose text has a vector is given it and not embedded again

- Status: Accepted
- Date: 2026-11-13
- Builds on [ADR-0064](0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md) (vectors keyed by the body they were computed from) and [ADR-0065](0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md) (a change of model is a backfill).

## Context

The vectors of sections are kept by body: the git blob hash, the model, the version of the sectioning rules, the section's place. A body embedded once serves every commit, ref and fork that holds the same bytes, and that was the whole of what was reused. A file edited in one place is another body, and every section of it was embedded again, the ones that say what they said with the one that changed.

Replaying the history of two repositories as the worker embeds them, a body once and every section of it, showed what that costs: of the sections embedded for the documents of this repository, three in four were a text embedded before, and of those of the reference pack two in three; counted in characters, 63% and 55%. Embedding is the slow part of serving a pack by meaning, about half a second a section on a CPU, and it is the cost that comes back with every push.

## Decision

1. **A section's vector is kept with the hash of the text it was made from**: SHA-256 of the text the model was given, the section's title and heading path with its body, in `section_vectors.text_hash`.
2. **Before a body's sections are embedded, their texts are looked up.** A text that has a vector under the same model and dimensions is given that vector, written for the new body as any other, and costs no call; the rest go to the model. The version of the sectioning rules is not part of the lookup: a vector is the model's reading of a text and of nothing else.
3. **A slice says how many sections it wrote without a call** (`reused`, in its log line), and counts tokens for the calls it made. The bounds of the embedding are measured in the bytes of the bodies, as before: what is bounded is what a repository may have embedded, not what the model was asked.
4. **Nothing is computed for the vectors that are there.** A row written before this, or brought in from elsewhere, has no hash and is never found by its text. A file's first change after this embeds it whole once more; from then on a change costs what changed, and a full embedding under a new model, which is expected from time to time, writes the hash of everything.

## Consequences

- A push costs the sections it changed, and a body made of sections read before costs no call at all.
- A change of the rules that cut documents into sections, which is a new key, costs the sections that come out differently and not every section.
- A change of model reuses nothing but what repeats within it: another model reads the same text otherwise.
- The same text in two repositories has one reading, whoever may see either: a vector says nothing its text does not, and is reached only through an index entry the caller may see, as the body is.
- A vector is still stored for each body and section. Storing one for every text was looked at and left: what repeats is mostly the older versions of a file, which nothing searches (ADR-0092).
- Rejected: computing the hashes of the stored vectors in a backfill (every body read and cut again, for what the next change of each file and the next full embedding do anyway).
