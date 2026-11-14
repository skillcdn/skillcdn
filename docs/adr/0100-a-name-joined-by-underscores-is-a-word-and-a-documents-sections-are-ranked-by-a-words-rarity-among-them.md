# ADR-0100: A name joined by underscores is a word, and a document's sections are ranked by a word's rarity among them

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0069](0069-a-word-of-a-query-weighs-by-its-rarity-among-the-entries-searched.md) (a word weighs by its rarity among the entries searched, and a code is a word beside its parts) and [ADR-0078](0078-a-word-joined-by-slashes-or-dots-is-a-word-beside-its-parts.md) (a token joined by slashes or dots is a word beside its parts). It replaces one sentence of ADR-0069: that the sections of a document are ranked with the weights of the mount.

## Context

A document that describes a data format is full of names written with underscores, the fields of an interface, the identifiers of code: `TIDE_RATE_C2`, `BERTH_ID`. Such a name was read as its parts alone, `tide`, `rate`, `c2`, since the underscore parts words as a blank does. A code joined by hyphens and a token joined by slashes or dots are each a word as a whole as well (ADR-0069, ADR-0078); a name joined by underscores was not.

And a long table of such names stands in sections of a few dozen rows, as the format asks (a section is what is read at once). Every section holds the parts of every name, `c2` in each of fifteen sections, and one section holds the name asked for. The sections of a document were ranked with the weights of the mount, how many documents of the pack hold each word, and that says which document is meant and nothing of which section: a word every section of the one table holds and a word one section holds weigh the same where the table is the only document that holds either.

Measured on a table of 600 rows in fifteen sections, each headed by its first and last name, every name asked for as written: the section that holds the row stood first for 104 of the 600 names. With the same names written with hyphens, which are words as a whole, for 289 inside the table's folder, and for 600 once the words were weighed by the sections of the document.

On the two evaluation sets, which hold no such names, by words alone:

| | Document pack, 60 questions: section first | among the first two | Six languages, 180 questions: section first | among the first two |
|---|---|---|---|---|
| As it was | 93% | 100% | 51% | 57% |
| Sections weighed by the document | 95% | 98% | 54% | 61% |
| And names kept whole | 95% | 98% | 54% | 61% |

The document found first is the same in every row (95% and 57%): neither change touches which document a search finds.

## Decision

1. **A name joined by underscores is a word of the vector beside its parts.** Parts of letters and digits joined by single underscores, `tide_rate_c2`, `berth_id`, `x86_64`, are kept whole and unstemmed, and the parts follow, read as they were. A run that is no such name, one with an underscore at an end or doubled, or one that a dot, a slash or a hyphen joins as well (`my_module.py`), is its parts as before.
2. **The sections of a document are ranked by a word's rarity among the sections of that document**: the weight ADR-0069 gives a word among the entries of a mount, counted over the sections of the one document. The weights of the mount rank the documents, as before, and are no longer read where a document's sections are ranked.
3. **The reading rules have a new version** (`INDEX_VERSION` 18), since the vector of an entry changes: a commit indexed under the rules before is rebuilt, and served from the index it has until it is (ADR-0068).

## Consequences

- A field or an identifier asked for as written finds the section that holds its row, where it found the first section of the table. A part of a name still finds the document.
- The name is one more lexeme where a document writes one. A query that writes a name matches the documents that hold it whole above those that hold its parts, by the rarity of the name.
- A deployment rebuilds its indexes after the update that brings this, by rank, and serves every pack from the index it had meanwhile. Until a commit is rebuilt, a name is found by its parts, as before. The vectors of the search by meaning are kept: they are made of the sections' texts, which did not change.
- `matchSections` of `@skillcdn/core` takes `weights` and does not read them, so that what calls it still compiles.
- The measurement of the names was made on one made-up table; the two sets say that the questions people ask of documents fare no worse, and a little better for their sections. One question of the sixty has its section third where it was second.
- Rejected: reading a table drawn with characters as a table of rows (`rows`); every way of drawing one has rules of its own, and a wrong reading is a table the original does not have. Such a table is had as it is written, through `code`.
