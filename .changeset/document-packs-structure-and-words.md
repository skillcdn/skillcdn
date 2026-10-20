---
"@skillcdn/core": minor
"@skillcdn/indexer": minor
"@skillcdn/reader": minor
"@skillcdn/serve": patch
"@skillcdn/cli": patch
---

Breaking: packs of documents are served through their structure and their words (ADR-0063, phase A).

- A search result names the sections of a document that matched: the heading path, the `offset` and `limit` that read the section with `read_repo_file`, and an excerpt, left out when it only repeats the document's summary. `FindItem` documents carry `sections`; the REST `find` body carries them as `sections` with a nullable `excerpt`.
- `browse_repo` given a file path answers the file's outline: every heading with its level, text, offset and the length of its section, paged. `BrowseResult` carries `outline` (`FileOutline`) and the REST `browse` body carries `outline`.
- The word rules read the scripts without word stems (Han, Hangul, Hiragana, Katakana) by pairs of characters, and a pack's `language` chooses the stemmer, English being the only one at present: `searchLexemes`, `queryLexemes` and `searchVectorOf` take a language, and `wordRulesOf` names the rules.
- The search vector is built by the indexer and stored as it is: `IndexEntry.search` holds it in the text form of a PostgreSQL `tsvector` (`serializeSearchVector`, `parseSearchVector`, `serializeSearchQuery`), and `IndexEntry.searchBody` is gone. `IndexStore.search` takes the lexemes of a query instead of the query. The reading rules are version 11, so a deployment rebuilds the indexes it holds when they are next asked for.
- New in `@skillcdn/core`: `outlineMarkdown`, `headingPaths`, `matchSections`, and the result types and REST schemas of sections and outlines.
- The `skillcdn` command outlines a file with `browse <pack> <file>`, prints the sections a search matched, and `check` prints how many sections each document has.
