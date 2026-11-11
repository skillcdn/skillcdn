# ADR-0081: A long original is laid out by its own numbers, in sections read at once

- Status: Accepted
- Date: 2026-11-11
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md), [ADR-0076](0076-originals-travel-in-the-pack-and-the-repositorys-visibility-decides-who-reads-them.md), [ADR-0079](0079-a-query-of-identifiers-alone-is-ranked-by-its-words.md) and [ADR-0080](0080-a-table-and-a-code-block-are-had-as-data-from-where-they-stand.md).

## Context

The format said how a handbook becomes a pack: one file per chapter, a title and a description, headings that name the parts, a map. An installation made a pack of two specifications of well over a thousand pages each, with numbered clauses that refer to each other by number, tables of codes that run for dozens of pages and definitions in a notation of its own, and ran agents on it with no connection to anything else. The first conversion made a file per page, 1,140 of them, and failed on one of the two documents outright; headings had lost their numbers, so a reference could not be followed; a table of several hundred rows was one section, read whole for one row.

The same installation then tried what a format could add. It built variants of the pack, among them a reading guide per set and a glossary, both made by a model from the documents, and ran the same trap questions on each. Laid out by the original's own numbers, every model answered every question, and twenty sessions on the trap questions scored 196 of 200. The guide and the glossary changed no answer and cost a tenth to a quarter more characters read; the glossary was opened at most once a session and stood before the text in a search for a name. Splitting the long sections cut what a search named from 14,000 to 23,000 characters down to 4,000 to 7,000. An index made mechanically from the documents, in one section of 50,000 characters, stood before the text in a search by meaning until it was kept to the words and cut into sections.

## Decision

1. **A chapter too long for one file is a folder**, with a map of its own: the files in the order of the original, each named by a number that keeps that order and by the first section it holds, each line of the map saying which sections, which rows of a long table and which pages of the original the file holds. A section is cut in two only when it alone is longer than a file, between its paragraphs or between the rows of a table.
2. **A heading carries the number and the name the original gives the section**, and what the original sets in a fixed-width font stays a fenced code block, with its indentation, one block across a page break.
3. **A section is what an agent reads at once, a few thousand characters.** A long table stands in sections of a few dozen rows, each under a heading that names the table and its first and last row, the header row repeated; a title the original sets inside a section is a heading one level below. `check` notes a section longer than one read carries, `section_large`, and fails nothing for it.
4. **An index is a lookup table from a name to the file and the section that hold it**, made mechanically, in sections of a few dozen rows, in a folder kept to the words by its manifest.
5. **A reading guide per set and a glossary are not part of the format.** A pack may hold them as it may hold any document; the format asks for neither, and `check` looks for neither. A summary of chapters, a summary the server makes and a graph of relations stay out as before.
6. **The method stays the reference pack's**: how an original is surveyed and converted to this shape is said in its skills, which follow the format and define nothing of it ([ADR-0076](0076-originals-travel-in-the-pack-and-the-repositorys-visibility-decides-who-reads-them.md)).

## Consequences

- The format's document packs gain four sentences and the guide a section; nothing in the reading rules changes, and no index is rebuilt for it.
- A pack laid out this way is what the other decisions of the same work serve: a clause number finds the file whose heading names it ([ADR-0079](0079-a-query-of-identifiers-alone-is-ranked-by-its-words.md)), a table in sections is still one table to a program ([ADR-0080](0080-a-table-and-a-code-block-are-had-as-data-from-where-they-stand.md)), and a reference by number can name its section.
- The specification pack of the fixtures is laid out this way, as the example a test can hold.
- What was measured is two documents in one language, with models whose answers were already near the ceiling: that the guide and the glossary add nothing says that they added nothing there. They are looked at again when a task or a model shows a difference.
- Rejected: a file per page (no title, no summary, and a section cut at every page break); a file per original (too large to read by sections, and over the indexing limit); a limit on section length enforced by the reading rules (a section is the author's, and a long code block is one thing); headings renumbered by the converter (the reference in the text would name a number nothing carries).
