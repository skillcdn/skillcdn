# @skillcdn/indexer

## 0.6.0

### Minor Changes

- [`7e803b6`](https://github.com/skillcdn/skillcdn/commit/7e803b60a76015f93d809bf8a2b5362bae94593d) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Breaking: the `SKILL.md` a skill is served as names no commit, so its digest changes when the skill changes and through no other push (ADR-0117). The first line reads `> Assembled by SkillCDN from <paths>.`, and a file left out for its size is named by the address of its git object, with the header to send where the host needs one (`Accept: application/vnd.github.raw+json` at GitHub), instead of its raw address in the commit served. `load_skill` and the REST skill route still name such a file in the commit they read. A host that verified a skill is asked once more, when the commit is reindexed, and then only when the skill changes.
  
  The reading rules are at version 20, so every index is rebuilt; an index of an older version is served as it was digested until then. In `@skillcdn/core`, `provenanceLine` takes the sources first and the commit only for such an older index, `SkillDocumentInput.commit` and `SkillDocumentSources.commit` are optional for the same reason, an `OmittedFile` may carry `accept`, and `blobFileUrl` and `COMMITLESS_DOCUMENT_INDEX_VERSION` are new.

### Patch Changes

- [`67e9d7d`](https://github.com/skillcdn/skillcdn/commit/67e9d7dadd0a58d9f28657f5f79ada1cccb3fda8) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A link whose destination is a skill URI names a file of another pack (ADR-0120): `[the base skill](skill://gh/acme/skills/design/card/SKILL.md)`, in a skill, in a manifest's rules or in any served Markdown document. The index keeps the link with the file that holds it and looks into no other repository. The first page of `load_skill` and a page of `read_repo_file` list what they link to in other packs, under `In other packs, not readable here:`, with how each is read at its pack; the REST API answers `packReferences` on a skill and on a file page. A destination under the scheme that is no skill URI, one with a ref or without a path, is the index diagnostic `pack_link_invalid`.
  
  `skillcdn check` lists the files of other packs a directory links to, and `skillcdn check --references [--url <origin>]` reads each once at a deployment: a file its pack does not have fails the check, and one that could not be asked about is `not known`. The reading rules are at version 22.
  
  In `@skillcdn/core`, `inspectMarkdownLinks` answers `packs`, and `PackLink`, `PackReference`, `restPackReferenceSchema` and `MAX_PACK_LINKS` are new; in `@skillcdn/indexer`, `checkDirectory` takes `verifyPackReferences`.

- [`669e216`](https://github.com/skillcdn/skillcdn/commit/669e2167f754a1fa53cdde037e906dba71e10213) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A `SKILLCDN.md` can name the page an agent reads first (ADR-0119): `start: docs/finding-a-skill.md`, the path of a Markdown document relative to the manifest. A client is told on connect `Start here, before a task: read_repo_file <path>.`, in the place of the line that names the README, by every mount that can read the page. The page is served as a document wherever it stands. A path that names no Markdown document of the repository, or one that is excluded, is the index diagnostic `start_missing`, which `skillcdn check` fails on; `check` prints the field with the manifest.
  
  The REST API answers the page as `start` in the manifest of a mount. The reading rules are at version 21. In `@skillcdn/core`, `RepoManifest`, `MountManifest` and `CatalogManifest` carry `start`.

- [`3f12aca`](https://github.com/skillcdn/skillcdn/commit/3f12acaf65d338fdf50305fb7f7ee744f3578d74) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn check` names its own version in the first line of the report, beside the version of the reading rules: `(skillcdn 0.6.0, reading rules version 20)`. When the npm registry has a later release of the command, a line on standard error says so and how to run it. A command that `npx` took from its cache read a pack by older rules and said nothing of it.
  
  The request to the registry is the only one `check` makes. It waits at most a second and a half, changes neither the report nor the exit code, and is left out with `--offline` or `SKILLCDN_OFFLINE=1`. The documented commands are now `npx @skillcdn/cli@latest check`.
  
  In `@skillcdn/indexer`, `checkDirectory` takes `command`, what ran it, for that first line.

- [`59a1ecd`](https://github.com/skillcdn/skillcdn/commit/59a1ecd5affa553f5e63ef3ea591d4a734c015a8) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn check` says for each skill how large its context is and in how many pages an agent reads it: `context: 42459 bytes, read in 3 pages (rules 19, instructions 20, included 42420)`. A skill whose instructions and included files are over the 16 KiB the format recommends gets one line more, with what each included file weighs, the largest first, and the report's notes count such skills (`skill_large`). It is a note: the exit code is as before.
  
  The pages are counted by the function the reader cuts them with: `pageOfContext` and `countContextPages` are new in `@skillcdn/core`.
- Updated dependencies [[`67e9d7d`](https://github.com/skillcdn/skillcdn/commit/67e9d7dadd0a58d9f28657f5f79ada1cccb3fda8), [`669e216`](https://github.com/skillcdn/skillcdn/commit/669e2167f754a1fa53cdde037e906dba71e10213), [`9cce1dd`](https://github.com/skillcdn/skillcdn/commit/9cce1dd5af2481a23cbe8239f007c8ed63fb2381), [`59a1ecd`](https://github.com/skillcdn/skillcdn/commit/59a1ecd5affa553f5e63ef3ea591d4a734c015a8), [`7e803b6`](https://github.com/skillcdn/skillcdn/commit/7e803b60a76015f93d809bf8a2b5362bae94593d)]:
  - @skillcdn/core@0.6.0

## 0.5.3

### Patch Changes

- [`a042163`](https://github.com/skillcdn/skillcdn/commit/a04216367ec8390a6ebbddf3a55b6a7c29b45f09) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A search in words finds the page a name joined by capitals heads. `BerthAssigned` was one word, so "berth assigned" found nothing of the page with that title. Where a name names something, in the name and title of an entry, the words of its path and the headings of its body, the words it is joined of are now words beside it (`berth`, `assigned`; `XMLReader` gives `xml` and `reader`, `Base64Encode` gives `base64` and `encode`). The body and a query are read as before: a name asked for matches whole.
  
  The reading rules are at version 19 (`INDEX_VERSION`): a deployment rebuilds the index of each commit when it is next asked for and serves the one it has until then; the vectors of the sections are kept. `searchLexemes` takes a third argument, `names`, and a `SearchField` may say `names: true`.

- [`616989e`](https://github.com/skillcdn/skillcdn/commit/616989ea3b6793001ad841ee35a0207ad967c434) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The instructions of a connection keep a line for every folder while its path fits. Before, the folder lines were written whole until one did not fit in the 2,000 characters, and that folder and every one after it were left out without a word. Now the descriptions are cut to one length for all the folders, then left out, then the names, so that a pack that grows loses words before it loses folders; where the paths and counts alone do not fit, a line says how many folders are not listed. A pack whose lines fit is told as before.
  
  `skillcdn check` says beside the length of the instructions when the folder lines say less or some are left out. `@skillcdn/core` exports `fitInstructions`, which answers the text with what became of the rows, `catalogGroups` and `holdsSomething`; a catalog may carry `groupCount`, and the `mounts` answer of the REST API carries it as `index.groupCount`.
- Updated dependencies [[`a042163`](https://github.com/skillcdn/skillcdn/commit/a04216367ec8390a6ebbddf3a55b6a7c29b45f09), [`f86a5db`](https://github.com/skillcdn/skillcdn/commit/f86a5db7a720cdb458dd69bf160e414c934c6094), [`616989e`](https://github.com/skillcdn/skillcdn/commit/616989ea3b6793001ad841ee35a0207ad967c434)]:
  - @skillcdn/core@0.5.3

## 0.5.2

### Patch Changes

- [`ff6af5e`](https://github.com/skillcdn/skillcdn/commit/ff6af5e8e374ba45c0981d880790c75d9f0661ff) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `buildSnapshotIndex` gives the process back every 64 KiB of text it reads, so that a server indexing a large commit in the process that answers its requests goes on answering them. Once the bodies were in hand, the reading of every document ran as one turn of the event loop: on a repository of 1,679 documents read for search, 4.3 seconds of a 5-second build, and 0.14 seconds now. The index is the same. `pause` in the options replaces the next turn of the event loop with a function of your own.
- Updated dependencies [[`c7b1640`](https://github.com/skillcdn/skillcdn/commit/c7b1640441bfdcacd1ccf795466be3b382353e02), [`f5cf4dd`](https://github.com/skillcdn/skillcdn/commit/f5cf4dde7d45f200b9a531d2313cd4e8ce324145)]:
  - @skillcdn/core@0.5.2

## 0.5.1

### Patch Changes

- [`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A field or an identifier written with underscores is found as written (ADR-0100). `TIDE_RATE_C2` was read as its parts alone, which every row of the table that lists it holds; it is now a word of the search vector as a whole beside them, as a code joined by hyphens and a token joined by dots already are. And the sections of a document are ranked by how rare a word is among the sections of that document, where they were ranked by how rare it is in the pack: the name then finds the section that holds its row, where it found the first section of the table. `matchSections` of `@skillcdn/core` still takes `weights` and no longer reads them. The reading rules have a new version (`INDEX_VERSION` 18): a deployment rebuilds the index of each commit and serves the one it had meanwhile, and `skillcdn` reads a directory under the new rules at once.

- [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page a read cuts ends at the end of a line. A file longer than one read carries was cut by the count of its characters, in the middle of a line: a row of a table drawn with characters, cut there, reads as a row whose other cells are empty. A page cut by the default length, or by the size a response may have, now ends after the last line that is whole in it, and `nextOffset` begins the next line; a `limit` that was asked for and fits is given as measured, since that is how a section is read. In `@skillcdn/core`, `pageOfText` takes `{ atLineEnd: true }` for it. `skillcdn check` says of a section longer than one read what to do with a long code block as well, and the format says that what an original sets in a fixed-width font keeps its alignment, every character at its column.
- Updated dependencies [[`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4), [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390), [`4416e43`](https://github.com/skillcdn/skillcdn/commit/4416e43a3a184aa5ced2bbe657198faf054dc9ae), [`6b050be`](https://github.com/skillcdn/skillcdn/commit/6b050bef6e52bdb454f949a8eaf31bdd07706536), [`1475fc3`](https://github.com/skillcdn/skillcdn/commit/1475fc3f296daec0b2cae0140fa1b911df1e3f54), [`6010c2f`](https://github.com/skillcdn/skillcdn/commit/6010c2f50a9f2bf53a0b0dc37b4e2dbad1db0a45), [`75bfccf`](https://github.com/skillcdn/skillcdn/commit/75bfccf4c6c2218bac98a561dfb0b825be47e70b)]:
  - @skillcdn/core@0.5.1

## 0.5.0

### Minor Changes

- [`4cd8d35`](https://github.com/skillcdn/skillcdn/commit/4cd8d35cf19062346274a84f5a40bb56aec9931f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Breaking: a document made from the pack's documents says so, and its quotations are checked (ADR-0083, reading rules version 16). A document with `derived` in its front-matter (`kind`, `from`, `by`, `at`) is marked in the index (`frontMatter.derived`) and in a search result (`(made from other documents: quote what it points to)`, `derived: true` over REST); every block quote of it must end with a link to the section quoted, and the indexer holds the quotation against that section word for word, with links, markup and blanks folded on both sides and `…` for words left out. `check` and a deployment report `quote_not_in_source`, `quote_without_link` and `derived_from_missing`. `core` exports `documentDerivation`, `quotationsOf`, `quotationStandsIn` and `foldQuoted`.

- [`67c8df3`](https://github.com/skillcdn/skillcdn/commit/67c8df37c41c15f55bbe3016ebbc9a1c3f96831d) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Breaking: the fragment of a link names a section, and a file read lists its references by file with what reads each section (ADR-0082, reading rules version 15). `guide.md#4.2.7` names the first heading of `guide.md` whose words, in lower case and joined by hyphens, are the fragment or begin with it where a word ends, with every section under it; the indexer keeps the offset and the length with the reference (`references[].section` of an index entry, of `FileReference` and of the REST `files` answer) and reports a fragment that names nothing as `fragment_not_found`. The text a `read_repo_file` result ends with changes from `- <href> -> <path> (<status>)` to `- <path>: <fragment> (offset N, limit M); ...`, a file once, up to twelve links and the count of the rest (`FileResult.referencesMore`); a skill's references are listed as before. `inspectMarkdownLinks` answers a reference's `fragment` and bounds the references by the files they name (`MAX_MARKDOWN_REFERENCES`, 200) and the links to them (`MAX_MARKDOWN_LINKS`, 2,000) in place of 200 links. `core` exports `sectionOfFragment`, `fragmentResolver`, `headingSlug` and `fragmentOf`.

- [`85264e1`](https://github.com/skillcdn/skillcdn/commit/85264e13a79dd400aae63be18c231b385f22bb23) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Breaking: a token joined by slashes or dots is a word of the search vector beside the words it joins (ADR-0078, reading rules version 14). `open/closed/held` is found by `closed` and `ops.intake.queue` by `intake`, as a hyphenated word has always been found by its parts; a part of a dotted token that is digits alone is no word of its own, so a section number or a version (`4.2.6`) stays one word, and a URL and an address stay as they were read. `searchLexemes` and `queryLexemes` answer the parts after the whole, so every position after such a token moves; an index built under an older version is rebuilt when it is next asked for, and served as it is meanwhile.

### Patch Changes

- [`18f1bae`](https://github.com/skillcdn/skillcdn/commit/18f1baeffd01f766da55f37161bbf603ba046a51) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `check` notes a section of a document that is longer than one read carries, 40,000 characters, as `section_large` under a new `Notes` heading of its report: a table of several hundred rows under one heading is the usual one, and is better written in sections of a few dozen rows (ADR-0081). A note fails nothing: the exit code is as it was.
- Updated dependencies [[`4cd8d35`](https://github.com/skillcdn/skillcdn/commit/4cd8d35cf19062346274a84f5a40bb56aec9931f), [`67c8df3`](https://github.com/skillcdn/skillcdn/commit/67c8df37c41c15f55bbe3016ebbc9a1c3f96831d), [`9b72da2`](https://github.com/skillcdn/skillcdn/commit/9b72da22ee37ec22bb1133825a4795b112db031b), [`fd7d61d`](https://github.com/skillcdn/skillcdn/commit/fd7d61d6e3e34086106cfc227e843a6bf25087fa), [`85264e1`](https://github.com/skillcdn/skillcdn/commit/85264e13a79dd400aae63be18c231b385f22bb23), [`dc29485`](https://github.com/skillcdn/skillcdn/commit/dc29485912bc71c7685838719782d4528f44b7d8), [`ca30bdf`](https://github.com/skillcdn/skillcdn/commit/ca30bdf165cc03632c619852a53c287c5486f720)]:
  - @skillcdn/core@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`728f791`](https://github.com/skillcdn/skillcdn/commit/728f791d3ec4e1497f0d0d6f2c2b6216ed4cfdcb), [`8aee133`](https://github.com/skillcdn/skillcdn/commit/8aee13321eb11e4341b11f8542d93e68d911cd70), [`284f15d`](https://github.com/skillcdn/skillcdn/commit/284f15d9833dfb7de2e5c5b60150ded713b17285)]:
  - @skillcdn/core@0.4.2

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
