# @skillcdn/indexer

## 0.4.1

### Patch Changes

- [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A pack carries the originals its documents were made from and the pictures they show, and a read of such a file ends in a link that opens (ADR-0076, ADR-0077).
  
  - `@skillcdn/core`: `isBinaryPath` and `isImagePath` know a file by its extension; `parseLfsPointer` reads a Git LFS pointer; `lfsFileUrl` and `localRawFileUrl` name where a host serves a file kept in LFS and where a deployment serves the files of a directory pack, and `rawFileUrl` of a `local` repository is now that route, `/api/v1/raw/<address>?path=`, instead of the page of the file; `inspectMarkdownLinks` lists a document's references, pictures with their alternative text, and links to other files, and `resolveLocalLink` resolves any local destination; `documentSources` and `resolveDocumentSource` read a document's front-matter `source`. A `FileOutline` may carry the document's `images` and `sources`, a `FileResult` its `sources` on the first page, a `BrowseResult` the `manifestPath` of the folder, a directory `BrowseEntry` its `imageCount`, a document `FindItem` `overview: true` when it is the README of its folder, and a `not_text` lookup `lfs` with the size of the file a pointer stands for; the REST schemas take the same fields, all optional. `accessHint` and `describeSource` write the line a refused read ends with, which names the credential a private repository's file needs. `searchFieldsOf` takes the headings of a document, weighed with the words of the path, above the body. The rendered results say all of this: the manifest of a folder, the pictures of a folder, the originals and pictures of a document, a map among search results.
  - `@skillcdn/indexer`: reading rules version 13. The headings of a document weigh above its body; a local link that names no file, a picture without alternative text, a picture or an original that is not there, and a skill's reference to a file that is not text are diagnostics. The bodies the store lacks are fetched in one archive before the rounds, only when the archive is not much larger than what is needed, so that a pack full of originals is read file by file and its originals are never downloaded. `readWorkingTree` reads with the tree only the files the reading rules read as text; every other file is listed with a stand-in hash from its path, size and modification time, with `bytes` left out as for a file over the limits, and read from disk through `read` when its bytes are asked for; `bytesOf` reads either, `openWorkingTreeFile` opens a file of a tree to be streamed as it is, and `readDirectory` answers `readBlob`. `check` says of a directory without a license that a directory is served in full, and what a deployment would do.
  - `@skillcdn/reader`: a file whose name says that it is not text is never fetched to learn that, unless it is small enough to be a Git LFS pointer; a body the store holds and does not read as text is not fetched again; a body fetched and found not to be text is remembered in the process, since its bytes are not kept. A read of a pointer answers where the mount's `lfsUrl`, new on `MountContext` and optional, serves the file. `rawFile` says whether a file of a mount is served, for whoever sends its bytes. Outlines carry a document's pictures and originals on their first page, a file its originals on its first page, a folder its manifest, and a search result marks the README of a folder as its overview.
  - `@skillcdn/serve`: `GET /api/v1/raw/<address>?path=` sends a served file as an attachment from the `rawFile` the app gives the routes, with `rawFileHeaders`, and sends the reader on to the source with a redirect where it has none; over HTTP `createLocalApp` names that route, at the origin asked at, as the source of every file (`mountServedAt`). A refused read of a private repository's file says how to fetch it, and a Git LFS pointer where the host serves the file.
  - `@skillcdn/cli`: a picture or an original of a directory is answered with its `file:` URL by the reading commands and over standard input and output, whatever its size, and from the server's own raw route over HTTP, where `skillcdn serve` sends the file itself; a served directory deleted and made anew in the same place is watched and read again.
- Updated dependencies [[`0f51e91`](https://github.com/skillcdn/skillcdn/commit/0f51e912a1e5da13c97464f708f122fac9444254), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f), [`14e1d39`](https://github.com/skillcdn/skillcdn/commit/14e1d39b30ebacaa0e16c78b9c3c31e27befd63b), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f)]:
  - @skillcdn/core@0.4.1

## 0.4.0

### Minor Changes

- [`a9da901`](https://github.com/skillcdn/skillcdn/commit/a9da901f2a4a6b0f28a5e590e2214b8d700bb710) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Breaking: packs of documents are served through their structure and their words (ADR-0063, phase A).
  
  - A search result names the sections of a document that matched: the heading path, the `offset` and `limit` that read the section with `read_repo_file`, and an excerpt, left out when it only repeats the document's summary. `FindItem` documents carry `sections`; the REST `find` body carries them as `sections` with a nullable `excerpt`.
  - `browse_repo` given a file path answers the file's outline: every heading with its level, text, offset and the length of its section, paged. `BrowseResult` carries `outline` (`FileOutline`) and the REST `browse` body carries `outline`.
  - The word rules read the scripts without word stems (Han, Hangul, Hiragana, Katakana) by pairs of characters, and a pack's `language` chooses the stemmer, English being the only one at present: `searchLexemes`, `queryLexemes` and `searchVectorOf` take a language, and `wordRulesOf` names the rules.
  - The search vector is built by the indexer and stored as it is: `IndexEntry.search` holds it in the text form of a PostgreSQL `tsvector` (`serializeSearchVector`, `parseSearchVector`, `serializeSearchQuery`), and `IndexEntry.searchBody` is gone. `IndexStore.search` takes the lexemes of a query instead of the query. The reading rules are version 11, so a deployment rebuilds the indexes it holds when they are next asked for.
  - New in `@skillcdn/core`: `outlineMarkdown`, `headingPaths`, `matchSections`, and the result types and REST schemas of sections and outlines.
  - The `skillcdn` command outlines a file with `browse <pack> <file>`, prints the sections a search matched, and `check` prints how many sections each document has.

### Patch Changes

- [`b6ae700`](https://github.com/skillcdn/skillcdn/commit/b6ae700f79f0aebffff60b31cd2a25841c8c0ec7) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A deployment serves packs from a directory of its own at `local` addresses (ADR-0071). In `@skillcdn/core`, the coordinates of the git-host port (`RepoCoordinates.host`) carry any host of an address, `sourceFileUrl` and `rawFileUrl` take one and answer the page of the address at the file for `local`, which the new `localFileUrl` builds, and the REST repository's `avatar` is documented as the empty string for an owner with no picture. `@skillcdn/indexer` exports `readWorkingTree` and `LocalFile`, the files of a directory as tree entries with their bytes, and `BuildIndexOptions.repository.host` takes any host of an address.

- [`57f0ad6`](https://github.com/skillcdn/skillcdn/commit/57f0ad6aa0ab3c6f4fd092d6923d7650367a9e6e) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Each word of a query weighs by its rarity among the entries searched: a code, a number or a name that few documents hold decides the order, a word every document repeats decides next to nothing, and the sections of a document are ranked with the same weights. `rankSearchVector` and `matchSections` take the weights, `queryWeights` makes them from how many entries hold each word, and the `IndexStore` port gains `frequencies(path, lexemes)`, which the memory index answers; a store that does not count leaves it out and ranks as before. A match in a name now counts twice a match in the body, no more (`SEARCH_WEIGHTS` 1.0, 0.85, 0.7, 0.5 for the name, the description, the path and the body). A hyphenated code with a digit part, or across scripts (`OIW-PV-120`, `6635-81-302-5518`, `서돌-4`), is a word of the search vector beside its parts, so that the code finds the one document that holds it; the reading rules are at version 12 for it, and a deployment rebuilds its indexes as they are next asked for.

- [`8dbdc10`](https://github.com/skillcdn/skillcdn/commit/8dbdc10ff3aa3598b244c6c754f2f6f5e0981815) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A repository manifest may keep the documents it governs out of the search by meaning (ADR-0064): `search: { meaning: false }` in `SKILLCDN.md`, read as `RepoManifest.search` and stored by the indexer in the manifest's front matter (`search`) when it says so, which `skillcdn check` reports. The `Entitlements` port gains the `embed` action, with `EmbedLimits` (bytes per repository, bytes per account and day) in its decision, and the `UsageSink` an `embedding` event with the tokens the model read, in `token`s, so that whoever operates a deployment bounds and meters what is embedded. The defaults in this repository allow everything and discard every event, as before.
- Updated dependencies [[`cd9e11c`](https://github.com/skillcdn/skillcdn/commit/cd9e11c78a468df5cb546b2936a86fea32e7a204), [`b6ae700`](https://github.com/skillcdn/skillcdn/commit/b6ae700f79f0aebffff60b31cd2a25841c8c0ec7), [`95c13d0`](https://github.com/skillcdn/skillcdn/commit/95c13d0229f5102de02e201b43a498bb8a4e8f76), [`8d532fe`](https://github.com/skillcdn/skillcdn/commit/8d532fe5e5c6dab381f6985e30bf4f5180c8fd93), [`5f1c0fc`](https://github.com/skillcdn/skillcdn/commit/5f1c0fc271d72807f45944fc45cb32f810e67a9a), [`0e2052c`](https://github.com/skillcdn/skillcdn/commit/0e2052c306625d0ebe75513c5e0ada3b4e23e5b5), [`64a6809`](https://github.com/skillcdn/skillcdn/commit/64a6809986b099cc4b098d5cb4dde1be30a7c711), [`7bd391d`](https://github.com/skillcdn/skillcdn/commit/7bd391d54aa43659ee47c3adba9c18f4819d3886), [`5887911`](https://github.com/skillcdn/skillcdn/commit/58879117dce4539aa4746b4f30f3ad159a0c94bc), [`9654820`](https://github.com/skillcdn/skillcdn/commit/9654820d3998cd6bd13e57f806d3c34100ee8090), [`57f0ad6`](https://github.com/skillcdn/skillcdn/commit/57f0ad6aa0ab3c6f4fd092d6923d7650367a9e6e), [`4290804`](https://github.com/skillcdn/skillcdn/commit/42908040e0f255c71e5987470f260c746a9ca4a5), [`a9da901`](https://github.com/skillcdn/skillcdn/commit/a9da901f2a4a6b0f28a5e590e2214b8d700bb710), [`23c5656`](https://github.com/skillcdn/skillcdn/commit/23c56560c7a474a308929e0dad0975d8798f9481), [`4f63a73`](https://github.com/skillcdn/skillcdn/commit/4f63a73adf5a3afdbbe9ae1dfe7ef6e4b7dd39d3), [`a62f704`](https://github.com/skillcdn/skillcdn/commit/a62f704ae441dfed59e188e584eaee54a1d26c43), [`82a10cc`](https://github.com/skillcdn/skillcdn/commit/82a10ccfb756897a0913bc5c7bc84012171d6689), [`7445571`](https://github.com/skillcdn/skillcdn/commit/74455715429a17389c9c6adfbfc448024bd9468b), [`8dbdc10`](https://github.com/skillcdn/skillcdn/commit/8dbdc10ff3aa3598b244c6c754f2f6f5e0981815), [`966a1b4`](https://github.com/skillcdn/skillcdn/commit/966a1b4222021aa217864bbedbe10fafa7c909be)]:
  - @skillcdn/core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`73c80b1`](https://github.com/skillcdn/skillcdn/commit/73c80b1c83894a33f9f35405a687eeb708f605c2)]:
  - @skillcdn/core@0.3.1

## 0.3.0

### Minor Changes

- [`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The `skillcdn` command reads a pack as an agent gets it over MCP, from a directory on this machine (ADR-0055): `skillcdn skills <directory>` prints what a client is told on connect and every skill and document, `browse`, `find`, `skill` and `file` print what `browse_repo`, `search_repo`, `load_skill` and `read_repo_file` give a model, rendered by the same functions with the reads named as the commands, or the JSON of the REST API with `--json`. A skill is printed whole. The directory is addressed as `local/<its parent>/<its name>`, or as `--as` says, and is verified. `@skillcdn/indexer` exports `readDirectory`, which reads a directory as the indexer reads a commit and which `check` now reads through; `@skillcdn/reader` exports `createMemoryIndex`, an index kept in memory and searched with the word rules of `@skillcdn/core`; the renderers of `@skillcdn/core` take `ToolWords`, the names of the four reads, with `MCP_TOOL_WORDS` as their default.

### Patch Changes

- Updated dependencies [[`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909), [`5a009f1`](https://github.com/skillcdn/skillcdn/commit/5a009f13e65baaed5c619d4c120d61f51d54bd38), [`475a68f`](https://github.com/skillcdn/skillcdn/commit/475a68f8bc59a73e03f49d11df990c6ec243a779), [`036386e`](https://github.com/skillcdn/skillcdn/commit/036386ed19592aa4f0b76e1289b2ef2293451d83), [`4e6b137`](https://github.com/skillcdn/skillcdn/commit/4e6b137e29c1a1e637f81a0edcd21702bf47e2dd)]:
  - @skillcdn/core@0.3.0

## 0.2.2

### Patch Changes

- [`2a62df4`](https://github.com/skillcdn/skillcdn/commit/2a62df4432ea4d57796ec692fc9612f652d67bd7) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The reading rules are at version 10: a README whose HTML block has indented lines is summarized by its first paragraph of prose, not by the markup. A commit indexed under the previous version is rebuilt when it is next asked for.
- Updated dependencies [[`2a62df4`](https://github.com/skillcdn/skillcdn/commit/2a62df4432ea4d57796ec692fc9612f652d67bd7), [`ac3130a`](https://github.com/skillcdn/skillcdn/commit/ac3130a4ebbb0fb5a0f1ff46b12a70413b8eda12)]:
  - @skillcdn/core@0.2.0

## 0.2.1

### Patch Changes

- [`76a9e4e`](https://github.com/skillcdn/skillcdn/commit/76a9e4e01289ce41f214db143b1a3f5512fc6ac9) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The README opens with the SkillCDN symbol, the package's one-line description and its badges: the version on npm, the state of CI, the license.
- Updated dependencies [[`76a9e4e`](https://github.com/skillcdn/skillcdn/commit/76a9e4e01289ce41f214db143b1a3f5512fc6ac9)]:
  - @skillcdn/core@0.1.1

## 0.2.0

### Minor Changes

- [`ad29c0c`](https://github.com/skillcdn/skillcdn/commit/ad29c0c83287a1ab617ba36e873080ffacbb30ce) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The report of `checkDirectory` is headed by the version of the reading rules it applied, so that an author can tell which rules a report came from when a deployment runs others. `skillcdn check` prints it in its first line.
