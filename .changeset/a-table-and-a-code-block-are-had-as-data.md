---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/serve": patch
"@skillcdn/client": patch
"@skillcdn/cli": patch
---

The tables and the fenced code blocks of a document are had as data (ADR-0080). `skillcdn rows [<pack>] [<path>]` prints the tables of a document, or of every document under a folder, as one CSV or as JSON, every row with the file and the section it stands in, and `skillcdn code` prints the code blocks as written; `--heading` keeps what stands under a heading, `--out` writes a file, `code --grep` filters by a pattern on this machine. The same is `GET /api/v1/rows/<address>` (`format=csv` for one CSV) and `GET /api/v1/code/<address>`, registered by `registerAddressRoutes` and read by the client's `rows` and `code`. The reader gains `rows` and `code`, and a mount may say where its data is had (`dataUrl`); the outline of a document says how many tables, rows and code blocks it holds and where they are had, and a heading how many rows its section holds (`tables`, `codeBlocks`, `data` and `rows` over REST). `core` exports `dataOfMarkdown`, `toCsv`, `rowsBody`, `codeBody`, `rowsCsv`, the schemas and the limits.
