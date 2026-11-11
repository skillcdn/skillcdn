# ADR-0083: A document made from the pack's documents says so, and its quotations are checked

- Status: Accepted
- Date: 2026-11-11
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md), [ADR-0081](0081-a-long-original-is-laid-out-by-its-own-numbers-in-sections-read-at-once.md) and [ADR-0082](0082-a-links-fragment-names-a-section-and-a-reference-is-resolved-to-it.md).

## Context

The format says that what an agent learns stays in the pack, as notes committed to a document set of their own. A note is a document made from the pack's documents: it says what a clause says, in fewer words, for the next run. Nothing told a note from the text it was made from, and nothing held what it said against that text. An installation tried it on such documents made by models: of 54 quotations in the drafts of a smaller model, six differed from the text they claimed to quote, and the model corrected them once a tool said so; a check that held each quotation against the section its link named caught 222 of 223 defects planted into such a document, and every one of 32 where the source was changed after the note was written. Accepting a link in the line after the quotation instead of in its last line missed three of twenty where the source line was removed.

The format does not ask for such documents ([ADR-0081](0081-a-long-original-is-laid-out-by-its-own-numbers-in-sections-read-at-once.md), point 5). It can say what the ones a pack holds owe the text they rest on.

## Decision

1. **A document made from the pack's documents says so in its front-matter**: `derived`, a mapping with `kind` (what it is: `note`, `glossary`), `from` (the documents or folders it was made from, written as a link destination is), `by` and `at`, each optional, or a word alone, which is the kind.
2. **What it quotes it quotes exactly, in a block quote whose last line links to the section quoted.** One form, so that it can be checked: the lines of the quotation, then a line with a link to the file and, as its fragment, the section. An elision, `…` or three dots, stands for words left out.
3. **The index holds each quotation against the section its link names**, when the commit is indexed and every body is at hand. Both sides are folded the same way, links to their words, the marks of emphasis, code and table cells out, every run of blanks one, and the parts of the quotation between its elisions must stand in the section in their order. A quotation that does not is `quote_not_in_source`; a block quote of a derived document with no link in its last line is `quote_without_link`; a `from` that names no file or folder is `derived_from_missing`. A link without a fragment is held against the whole file; a link that names no file or no section is reported as that already, and a section that is not served is not looked into. The reading rules move to version 16.
4. **A result marks a derived document**: `(made from other documents: quote what it points to)` in a search result, `derived` over REST. An agent quotes the section, never the note.
5. **Nothing compares dates.** A source changed after the note was written no longer says what the note quotes, and the quotation is reported; a date in `at` is for people.

## Consequences

- The notes a run commits are checked like everything else of the pack, by `skillcdn check` before a push and by the deployment's index after it: a misquotation, and a note that outlived its text, are the author's to hear of.
- A block quote in a derived document is always a quotation: a callout written as one is reported as having no source.
- The folding lets a quotation leave out what is markup and nothing that is a word; a quotation of a table row is its cells in order.
- The specification pack of the fixtures holds a note whose six quotations stand, and the indexer's tests plant a changed word, another order, another section, a missing source line and a changed source, and find each.
- Rejected: a diagnostic when a derived document is older than its source (the quotation check finds the change, and a clock is not part of a pack); a required guide or glossary per set (they changed no answer where they were measured); checking quotations in every document (a block quote elsewhere is the author's own, and a document says when it is made from others); a fuzzy match (a quotation that is nearly the text is the defect this is for).
