# ADR-0080: A table and a code block are had as data from where they stand

- Status: Accepted
- Date: 2026-11-11
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) and [ADR-0034](0034-a-tool-result-is-the-text-written-for-the-model.md).

## Context

A document pack is read through its structure: a search names a section, an outline gives the offset and the limit that read it, and a model reads the text. That serves a passage. It does not serve a table of several hundred rows that a task needs whole, a list of codes to build into a program, a set of definitions to generate from: the only way to get the table out of the pack was for a model to read it and write it again, row by row.

Measured in an installation, on a task that put a table of 864 rows in six files into code: a session that copied the table out ended at the output limit of its model, another ran into its time limit after an hour and a quarter, both with nothing made; the same model, given the table as a file by a tool, passed every check. The larger models wrote themselves a script to read the Markdown instead, every session anew.

## Decision

1. **The tables and the fenced code blocks of a document are data of the pack.** `core` reads them (`dataOfMarkdown`): a table as the names of its columns and its rows, each row as many cells as there are columns, the cells as written; a code block as its text and what it says it is written in. What stands in a fenced or an HTML block, in the front-matter or indented as code is no table.
2. **Two reads answer them for a file, or for every document under a folder**, in path order, which is the order a set is read in: `rows` and `code` on the reader, each table and block with the file and the heading path it stands in, and a `heading` that keeps what stands under a heading holding its words. A table that stands in several sections and files under the same header comes out as one stream of rows. A page is whole files, bounded in rows or blocks, in characters and in files read, with a cursor for the next; what a mount describes without serving, and what is over the read limit, is passed over.
3. **The reads are a REST route and a command each, and no MCP tool.** `GET /api/v1/rows/<address>` answers JSON, or one CSV with `format=csv`; `GET /api/v1/code/<address>` answers JSON; `skillcdn rows` and `skillcdn code` join the pages and print, or write a file with `--out`. A tool result is text for a model within a budget ([ADR-0034](0034-a-tool-result-is-the-text-written-for-the-model.md)), which is exactly what a table whole must not pass through; a program fetches it, and the agent's own tools run the program.
4. **The outline of a document says what it holds as data and where it is had.** On its first page: how many tables with how many rows, how many code blocks, and for each the URL of the route, or the command for a directory read on the machine; and beside each heading the rows its section holds. A mount says where through `dataUrl`, as it says where a file's bytes are.
5. **A pattern is the person's, on the person's machine.** `skillcdn code --grep` filters with a regular expression after the blocks are read; the routes take no pattern, since a pattern from anyone would run on the server.

## Consequences

- A table too long to copy is taken with one command or one request, with as many rows as the files write: the specification pack of the fixtures holds a table of 120 rows in three files against the rows of its files.
- A long table can be written as the format asks, in sections of a few dozen rows under headings that name their first and last row, and still be one table to a program.
- The routes read the bodies of every document under the path asked for, up to a page's bound of files; they are counted as reads of the REST API are, and kept by a cache as the other routes of a pinned address are.
- Nothing is added to what a client is told on connect and no tool is added to its list: a client that never meets a table pays nothing.
- Rejected: a third and a fourth tool (two more descriptions in every connection for a need few packs have, and a table through a tool result is the copy this avoids); a `format` on `read_repo_file` (a read is a page of one file's text, and a table spans files); cells as plain text with the markup taken out (a cell holds what its author wrote, and what is markup in it is the reader's to judge); a pattern on the route (a regular expression from a request is work without a bound).
