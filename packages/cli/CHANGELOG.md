# @skillcdn/cli

## 0.6.1

### Patch Changes

- [`c752fe1`](https://github.com/skillcdn/skillcdn/commit/c752fe113d1c46095506fb44b9857bed8d517c5f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page of a skill keeps whole every line that fits a page, counts its reach in bytes, and says how many pages are left; `skillcdn check` says where a page ends inside something ([ADR-0123](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0123-a-page-of-a-skill-counts-its-reach-in-bytes-and-keeps-whole-a-line-that-fits-a-page.md)).
  
  - **A line is cut only when it is longer than a page.** A page whose bytes ran out more than 2,048 characters into a line ended between two words of it; it now ends before the line. A line longer than a page is cut between two words, and never before a combining mark, a joiner or the vowel or final consonant of a Hangul syllable written in its letters.
  - **The place between two blocks is looked for within 4,096 bytes**, a quarter of a page, where it was 4,096 characters. Text of one byte a character is paged as before. Text of three bytes a character has pages three quarters full at least, where they could be half full, and keeps a table or a code block whole up to some 1,300 characters, where it was some 2,700.
  - **A page of a skill read in more than one says how many pages follow it**, in the line that names the next `load_skill` call and once more as its last lines, and the last page says that the skill is complete. Run with a command-line agent, two models that read a skill of seven pages to its end in none of six runs did in ten of eleven. The REST API answers the count as `pagesLeft`; the command's parts say as before.
  - **`skillcdn check` lists, under each skill, the pages that end inside a table, a code block or a line**, with the file and the line the next page begins at, and notes the ones that end inside a code block or a line as `page_cut`. A note fails nothing.
  - `@skillcdn/core` adds `contextPageCuts`, `CONTEXT_BLOCK_REACH` and the type `ContextCut`; `countContextPages` takes where to count from, and `contextLinesPage` what a page holds (`pageBytes`).
  
  Cursors stay good, and the reading rules do not change.
- Updated dependencies [[`08ee032`](https://github.com/skillcdn/skillcdn/commit/08ee032f7475c37c041904c12006990b3f469912), [`c752fe1`](https://github.com/skillcdn/skillcdn/commit/c752fe113d1c46095506fb44b9857bed8d517c5f)]:
  - @skillcdn/core@0.6.1
  - @skillcdn/indexer@0.6.1
  - @skillcdn/reader@0.6.1
  - @skillcdn/client@0.6.1
  - @skillcdn/inference@0.6.1
  - @skillcdn/serve@0.6.1

## 0.6.0

### Patch Changes

- [`fbfc31f`](https://github.com/skillcdn/skillcdn/commit/fbfc31f26081d20756d8d75cf11afdfc211c659b) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page of a skill after the first, and a part `skillcdn skill` reads from `--cursor`, no longer says the `License` line again. 0.5.3 said that a later part leaves the license out, and the line stayed: it is written from the license the reader resolved for the skill, not from the front-matter field that was left out. The first page says it as before, and a skill that is only described says it on every answer, since the license is why nothing else follows.

- [`67e9d7d`](https://github.com/skillcdn/skillcdn/commit/67e9d7dadd0a58d9f28657f5f79ada1cccb3fda8) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A link whose destination is a skill URI names a file of another pack (ADR-0120): `[the base skill](skill://gh/acme/skills/design/card/SKILL.md)`, in a skill, in a manifest's rules or in any served Markdown document. The index keeps the link with the file that holds it and looks into no other repository. The first page of `load_skill` and a page of `read_repo_file` list what they link to in other packs, under `In other packs, not readable here:`, with how each is read at its pack; the REST API answers `packReferences` on a skill and on a file page. A destination under the scheme that is no skill URI, one with a ref or without a path, is the index diagnostic `pack_link_invalid`.
  
  `skillcdn check` lists the files of other packs a directory links to, and `skillcdn check --references [--url <origin>]` reads each once at a deployment: a file its pack does not have fails the check, and one that could not be asked about is `not known`. The reading rules are at version 22.
  
  In `@skillcdn/core`, `inspectMarkdownLinks` answers `packs`, and `PackLink`, `PackReference`, `restPackReferenceSchema` and `MAX_PACK_LINKS` are new; in `@skillcdn/indexer`, `checkDirectory` takes `verifyPackReferences`.

- [`669e216`](https://github.com/skillcdn/skillcdn/commit/669e2167f754a1fa53cdde037e906dba71e10213) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A `SKILLCDN.md` can name the page an agent reads first (ADR-0119): `start: docs/finding-a-skill.md`, the path of a Markdown document relative to the manifest. A client is told on connect `Start here, before a task: read_repo_file <path>.`, in the place of the line that names the README, by every mount that can read the page. The page is served as a document wherever it stands. A path that names no Markdown document of the repository, or one that is excluded, is the index diagnostic `start_missing`, which `skillcdn check` fails on; `check` prints the field with the manifest.
  
  The REST API answers the page as `start` in the manifest of a mount. The reading rules are at version 21. In `@skillcdn/core`, `RepoManifest`, `MountManifest` and `CatalogManifest` carry `start`.

- [`9cce1dd`](https://github.com/skillcdn/skillcdn/commit/9cce1dd5af2481a23cbe8239f007c8ed63fb2381) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page of a skill, and a part `skillcdn skill` prints, ends between two blocks of Markdown where it can (ADR-0118): outside a table and a fenced code block, and not right after a heading or a line that ends in a colon, when such a place is within 4,096 characters of where the page would end. A rule or a file that begins late on a page with no such place begins the next one. A table longer than that is still cut after a row, and the page that goes on with it says the table's first two lines again above its text; the REST skill route answers them as `tableHead`, beside the text and not in it. Cursors stay good: they are offsets into the same context.
  
  The first page of `load_skill` names what it shortened: an `Abbreviated above:` line says which of the description, the metadata and the warnings were, and the references beyond the five it resolves are named by the files they point to, with the count of any it has no room for. It said only that something was abbreviated.
  
  In `@skillcdn/core`, `contextLinesPage` takes `mayBeEmpty`, `tableHeadAt` is new, and a `SkillResult` may carry `tableHead`, `detailsAbbreviated` and `referencesUnlisted`.

- [`3f12aca`](https://github.com/skillcdn/skillcdn/commit/3f12acaf65d338fdf50305fb7f7ee744f3578d74) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn check` names its own version in the first line of the report, beside the version of the reading rules: `(skillcdn 0.6.0, reading rules version 20)`. When the npm registry has a later release of the command, a line on standard error says so and how to run it. A command that `npx` took from its cache read a pack by older rules and said nothing of it.
  
  The request to the registry is the only one `check` makes. It waits at most a second and a half, changes neither the report nor the exit code, and is left out with `--offline` or `SKILLCDN_OFFLINE=1`. The documented commands are now `npx @skillcdn/cli@latest check`.
  
  In `@skillcdn/indexer`, `checkDirectory` takes `command`, what ran it, for that first line.

- [`59a1ecd`](https://github.com/skillcdn/skillcdn/commit/59a1ecd5affa553f5e63ef3ea591d4a734c015a8) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn check` says for each skill how large its context is and in how many pages an agent reads it: `context: 42459 bytes, read in 3 pages (rules 19, instructions 20, included 42420)`. A skill whose instructions and included files are over the 16 KiB the format recommends gets one line more, with what each included file weighs, the largest first, and the report's notes count such skills (`skill_large`). It is a note: the exit code is as before.
  
  The pages are counted by the function the reader cuts them with: `pageOfContext` and `countContextPages` are new in `@skillcdn/core`.

- [`100b1e8`](https://github.com/skillcdn/skillcdn/commit/100b1e85e1df190228e6e13b351197f84cd9e8bb) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn catalog [<directory>]` prints the skills of a directory as a Markdown table for the people who read its README (ADR-0121): each skill's name, linked to its `SKILL.md`, and the first sentence of its description, in path order, then how many there are; `--folder <path>` keeps it to one folder.
  
  `--write <file>` writes the table into a file of the directory, between `<!-- skillcdn:catalog -->` and `<!-- /skillcdn:catalog -->`, and leaves the rest of the file alone. A region lists the skills under the folder its file stands in, or under the one its opening comment names (`folder=marketing`); a file may hold several. `--check <file>` writes nothing and exits with `1` when a region is not what `--write` would make it, so that a job holds a README to the pack.
- Updated dependencies [[`fbfc31f`](https://github.com/skillcdn/skillcdn/commit/fbfc31f26081d20756d8d75cf11afdfc211c659b), [`67e9d7d`](https://github.com/skillcdn/skillcdn/commit/67e9d7dadd0a58d9f28657f5f79ada1cccb3fda8), [`669e216`](https://github.com/skillcdn/skillcdn/commit/669e2167f754a1fa53cdde037e906dba71e10213), [`9cce1dd`](https://github.com/skillcdn/skillcdn/commit/9cce1dd5af2481a23cbe8239f007c8ed63fb2381), [`3f12aca`](https://github.com/skillcdn/skillcdn/commit/3f12acaf65d338fdf50305fb7f7ee744f3578d74), [`59a1ecd`](https://github.com/skillcdn/skillcdn/commit/59a1ecd5affa553f5e63ef3ea591d4a734c015a8), [`7e803b6`](https://github.com/skillcdn/skillcdn/commit/7e803b60a76015f93d809bf8a2b5362bae94593d)]:
  - @skillcdn/serve@0.6.0
  - @skillcdn/core@0.6.0
  - @skillcdn/indexer@0.6.0
  - @skillcdn/reader@0.6.0
  - @skillcdn/client@0.6.0
  - @skillcdn/inference@0.6.0

## 0.5.3

### Patch Changes

- [`f86a5db`](https://github.com/skillcdn/skillcdn/commit/f86a5db7a720cdb458dd69bf160e414c934c6094) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page of a skill's context no longer ends inside a word. Where a page cuts a rule or an included file, it ends after the last line that ends within 2,048 characters of where its bytes run out, else between two words; the next page begins there, and cursors handed out before stay good. Pages over MCP, pages of the REST API and the parts `skillcdn skill` prints end the same way. `@skillcdn/core` exports `contextLinesPage`, which cuts so.
  
  `skillcdn skill` and `readPack` print the parts of a long skill without what they repeated: a part read from `--cursor` names the skill and its source and leaves out the description, the license and the lists of files and references the first part gave; a part names an included file only where it has some of it; and a section a part cuts says it continues "in the next part" (`ToolWords` may carry `piece`, the word for it).
  
  A read of a deployment makes fewer requests. `readPack` asks for the mount once where the text names the pack and its commit, and not at all for `rows`, `code` and the reads with `json`; the pack of `openDeployment` asks for what it reads and nothing first, and waits for the index only where the deployment answers that the commit is being indexed. A skill read took two requests for the mount and one more for every page; it takes one. A pack that pages a skill or its listing without end, or answers the same page again, is given up on as `invalid_response` instead of read forever. `@skillcdn/cli` exports `shellWord`, and the default line for the next part quotes a path a shell would split.

- [`ba20e73`](https://github.com/skillcdn/skillcdn/commit/ba20e732cb9b208fae65fe519b2d397a4839b496) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn use` says whether the `.skillcdn.json` it wrote is committed, before anything commits it: it is, so that every clone reads the same pack, unless the repository is public and the file names a deployment of your own or a private pack, which the organization keeps to itself; such a file goes in `.gitignore`, and each clone runs `skillcdn use` once. The command's help, its README and the guide on using skills say the same.

- [`616989e`](https://github.com/skillcdn/skillcdn/commit/616989ea3b6793001ad841ee35a0207ad967c434) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The instructions of a connection keep a line for every folder while its path fits. Before, the folder lines were written whole until one did not fit in the 2,000 characters, and that folder and every one after it were left out without a word. Now the descriptions are cut to one length for all the folders, then left out, then the names, so that a pack that grows loses words before it loses folders; where the paths and counts alone do not fit, a line says how many folders are not listed. A pack whose lines fit is told as before.
  
  `skillcdn check` says beside the length of the instructions when the folder lines say less or some are left out. `@skillcdn/core` exports `fitInstructions`, which answers the text with what became of the rows, `catalogGroups` and `holdsSomething`; a catalog may carry `groupCount`, and the `mounts` answer of the REST API carries it as `index.groupCount`.
- Updated dependencies [[`a042163`](https://github.com/skillcdn/skillcdn/commit/a04216367ec8390a6ebbddf3a55b6a7c29b45f09), [`f86a5db`](https://github.com/skillcdn/skillcdn/commit/f86a5db7a720cdb458dd69bf160e414c934c6094), [`616989e`](https://github.com/skillcdn/skillcdn/commit/616989ea3b6793001ad841ee35a0207ad967c434), [`7d386cf`](https://github.com/skillcdn/skillcdn/commit/7d386cf10e15d0675a8bb70a1806956eeb8397eb)]:
  - @skillcdn/core@0.5.3
  - @skillcdn/indexer@0.5.3
  - @skillcdn/reader@0.5.3
  - @skillcdn/serve@0.5.3
  - @skillcdn/client@0.5.3
  - @skillcdn/inference@0.5.3

## 0.5.2

### Patch Changes

- [`ee03669`](https://github.com/skillcdn/skillcdn/commit/ee03669b162727e7eac7e389cb12a99a12588b7c) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn use` prints a sentence for the checkout's agreement that has an agent run `skillcdn status` before its first step, and names `AGENTS.md` first, or `CLAUDE.md` where that is the file the agents read; the connection guide of the pages says the same. A checkout that carries the earlier sentence keeps working: copy the new one into it to have its agents look at what the checkout reads before they begin.

- [`70b9ee9`](https://github.com/skillcdn/skillcdn/commit/70b9ee912ddb107a46e4b9e6791bc184654eb7fe) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A query is embedded from its first 128 estimated tokens: some hundred words of English, or 160 characters of Korean. A search waits for its query, and a long one could take a server on one CPU past the five seconds a query has, leaving that search to its words. The words of a search still take the whole query.
  
  - `@skillcdn/inference`: `createEmbeddingsApi` takes `maxQueryTokens`, 128 unless you set it, and never more than `maxTextTokens`.
  - `@skillcdn/cli`: the commands that search a directory by meaning read `EMBEDDINGS_QUERY_TOKENS`, with the default a deployment has.

- [`0feb0fa`](https://github.com/skillcdn/skillcdn/commit/0feb0fa713e28b5c42aea03f2c47dda6d7d5cfd8) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `@skillcdn/cli` has a library entry point: the reads of a pack as the command prints them, for a program with commands of its own. `readPack(pack, read, options)` does one read (`skills`, `browse`, `find`, `skill`, `file`, `rows`, `code`) and answers the text, in the words you give it for the reads, or the REST API's JSON. `openDeployment` makes the pack of a deployment through `@skillcdn/client`. `PackError` and `ReadMisuse` say what the pack refused and what was not asked right, for you to print. The entry point imports nothing of the file system and nothing that indexes or serves. The `skillcdn` command prints what it printed before.

- [`9c4d216`](https://github.com/skillcdn/skillcdn/commit/9c4d216b7bf643bc0517948dfe64cafb779055e9) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn skill` prints a skill of more than 28,000 characters in parts, so that the host running your agent shows each part whole. A host may save a longer output to a file and show only its start, or cut it in the middle. Each part says that the skill's context is incomplete, and ends with the command that prints the next part, with its `--cursor`. Read every part before using the skill. A skill that fits is printed whole as before, and `--json` prints it whole.
  
  `skillcdn file` prints 24,000 characters of a file unless `--limit` says otherwise, ended at the end of a line, and says the offset to read on from. It printed 40,000 before. `--json` prints the page the REST API answers, 40,000 characters as before.

- [`f5cf4dd`](https://github.com/skillcdn/skillcdn/commit/f5cf4dde7d45f200b9a531d2313cd4e8ce324145) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A text is embedded within the tokens it is estimated to be, not only within its characters. The same eight thousand characters are some 1,600 tokens of English and over 7,000 of Hindi or of a list of hashes, and a server embeds a text more slowly the more tokens it has.
  
  - `@skillcdn/core`: `estimatedTokens` and `cutToTokens` estimate the tokens of a text for an embedding model, at or above what one tokenizer counts for every script measured. The `Embedder` port takes `maxTextTokens`.
  - `@skillcdn/inference`: `createEmbeddingsApi` cuts every text to `maxTextTokens` estimated tokens after its characters, 4,096 unless you set it. English and Russian sections of the default eight thousand characters are cut as before. A call whose time ran out is an `InferenceError` with `timedOut` set, and `isInferenceTimeout` tells it apart from a server that could not be reached; its code stays `inference_unreachable`. `cutText` takes the tokens as a third argument.
  - `@skillcdn/cli`: `skillcdn serve`, `mcp` and `embed` read `EMBEDDINGS_TEXT_TOKENS`, with the default a deployment has.
- Updated dependencies [[`ff6af5e`](https://github.com/skillcdn/skillcdn/commit/ff6af5e8e374ba45c0981d880790c75d9f0661ff), [`70b9ee9`](https://github.com/skillcdn/skillcdn/commit/70b9ee912ddb107a46e4b9e6791bc184654eb7fe), [`c7b1640`](https://github.com/skillcdn/skillcdn/commit/c7b1640441bfdcacd1ccf795466be3b382353e02), [`f5cf4dd`](https://github.com/skillcdn/skillcdn/commit/f5cf4dde7d45f200b9a531d2313cd4e8ce324145)]:
  - @skillcdn/indexer@0.5.2
  - @skillcdn/inference@0.5.2
  - @skillcdn/core@0.5.2
  - @skillcdn/client@0.5.2
  - @skillcdn/reader@0.5.2
  - @skillcdn/serve@0.5.2

## 0.5.1

### Patch Changes

- [`34b09f2`](https://github.com/skillcdn/skillcdn/commit/34b09f2ae9875d035abfc54b9c7c637a5ae7f653) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A call to an inference server may take as long as its timeout says. The platform's `fetch` ends a call whose answer has not begun after five minutes, whatever the call was given, so `EMBEDDINGS_TIMEOUT_MS` above 300000 never applied and a batch of long texts on a machine without a GPU failed at the same place every time it was tried. `@skillcdn/inference` exports `inferenceFetch`, one call over Node's HTTP client answered as `fetch` answers, which waits for as long as the signal of the call lets it and follows no redirect; the `skillcdn` command hands it to the adapters when it embeds a directory.

- [`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A field or an identifier written with underscores is found as written (ADR-0100). `TIDE_RATE_C2` was read as its parts alone, which every row of the table that lists it holds; it is now a word of the search vector as a whole beside them, as a code joined by hyphens and a token joined by dots already are. And the sections of a document are ranked by how rare a word is among the sections of that document, where they were ranked by how rare it is in the pack: the name then finds the section that holds its row, where it found the first section of the table. `matchSections` of `@skillcdn/core` still takes `weights` and no longer reads them. The reading rules have a new version (`INDEX_VERSION` 18): a deployment rebuilds the index of each commit and serves the one it had meanwhile, and `skillcdn` reads a directory under the new rules at once.

- [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page a read cuts ends at the end of a line. A file longer than one read carries was cut by the count of its characters, in the middle of a line: a row of a table drawn with characters, cut there, reads as a row whose other cells are empty. A page cut by the default length, or by the size a response may have, now ends after the last line that is whole in it, and `nextOffset` begins the next line; a `limit` that was asked for and fits is given as measured, since that is how a section is read. In `@skillcdn/core`, `pageOfText` takes `{ atLineEnd: true }` for it. `skillcdn check` says of a section longer than one read what to do with a long code block as well, and the format says that what an original sets in a fixed-width font keeps its alignment, every character at its column.

- [`6b050be`](https://github.com/skillcdn/skillcdn/commit/6b050bef6e52bdb454f949a8eaf31bdd07706536) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A question about a document is answered with the document, where a skill used to stand first nearly every time (ADR-0095). A skill was boosted twice wherever words and meaning were fused, by 1.5 in the words' rank and by 1.5 again on the fused score, which in a fusion by reciprocal rank is worth thirty places. It is now boosted once, where the results are put in one order, and by 1.05: `SKILL_RANK_BOOST` of `@skillcdn/core` is 1.05, a skill passes the documents up to three places ahead of it, and the words rank a skill as they rank a document. The index in memory (`@skillcdn/reader`) and with it the `skillcdn` command answer `search` in the words' order without a boost, and the reader orders the words answering alone by the same fusion, so the order of `find` changes where a skill and a document match about as well. An adapter of `IndexStore` that boosted skills itself would now boost them twice.

- [`1475fc3`](https://github.com/skillcdn/skillcdn/commit/1475fc3f296daec0b2cae0140fa1b911df1e3f54) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A skill is found by meaning through what it is named and says it does (ADR-0094). Its name and description are embedded as one text of their own, `name: description`, beside the sections of its `SKILL.md`, and a search by meaning compares that vector as it compares a section's. In `@skillcdn/core`, `embeddedTextsOf` lists every text a body is embedded as, a skill's head first under `HEAD_SECTION` (`-1`), and `headTextOf` writes the head; `embeddingTextOf` and `sectionsOf` are what they were. An index in memory (`@skillcdn/reader`) compares a head for a skill and for no document that holds the same bytes. The `skillcdn` command embeds the head with the sections, and a directory embedded before gets the heads of its skills on the next run, one short text each: the vectors kept in the cache stay, and a cache file gains an optional `head` mark that an older version of the command reads past.

- [`75bfccf`](https://github.com/skillcdn/skillcdn/commit/75bfccf4c6c2218bac98a561dfb0b825be47e70b) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn search <words...>` finds the pack to read when none is known: what the words find across every public pack a deployment serves (ADR-0070), each result under the address of its pack, which `skillcdn skill`, `file`, `browse` and `find` take first. `--limit` up to 20, `--url` or `SKILLCDN_URL` for a deployment of your own, `--json` for the answer of `GET /api/v1/search`; no token is sent, since the search covers public packs alone. It answers `1` at a deployment without such a search and `2` when the search did not answer in time. In `@skillcdn/core`, `renderHubResult` takes the words of the reads as an optional third argument and then says how a pack is read by its address in place of where to connect; without it the text is what it was.

- [`9aaec38`](https://github.com/skillcdn/skillcdn/commit/9aaec38711432a52ffdc820a7387f51f5954bb2f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn search` takes `SKILLCDN_URL` without `SKILLCDN_TOKEN`, as its help says: the search across packs sends no token, so the address of a deployment is all it needs. It used to refuse with "SKILLCDN_URL and SKILLCDN_TOKEN are taken together or not at all", which is the rule of the reads, where a token is sent.
- Updated dependencies [[`2dcee75`](https://github.com/skillcdn/skillcdn/commit/2dcee7531d0d8015ae57fb26f97947cc8d0b095d), [`34b09f2`](https://github.com/skillcdn/skillcdn/commit/34b09f2ae9875d035abfc54b9c7c637a5ae7f653), [`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4), [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390), [`4416e43`](https://github.com/skillcdn/skillcdn/commit/4416e43a3a184aa5ced2bbe657198faf054dc9ae), [`6b050be`](https://github.com/skillcdn/skillcdn/commit/6b050bef6e52bdb454f949a8eaf31bdd07706536), [`1475fc3`](https://github.com/skillcdn/skillcdn/commit/1475fc3f296daec0b2cae0140fa1b911df1e3f54), [`6010c2f`](https://github.com/skillcdn/skillcdn/commit/6010c2f50a9f2bf53a0b0dc37b4e2dbad1db0a45), [`75bfccf`](https://github.com/skillcdn/skillcdn/commit/75bfccf4c6c2218bac98a561dfb0b825be47e70b)]:
  - @skillcdn/inference@0.5.1
  - @skillcdn/core@0.5.1
  - @skillcdn/indexer@0.5.1
  - @skillcdn/reader@0.5.1
  - @skillcdn/serve@0.5.1
  - @skillcdn/client@0.5.1

## 0.5.0

### Patch Changes

- [`fd7d61d`](https://github.com/skillcdn/skillcdn/commit/fd7d61d6e3e34086106cfc227e843a6bf25087fa) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The tables and the fenced code blocks of a document are had as data (ADR-0080). `skillcdn rows [<pack>] [<path>]` prints the tables of a document, or of every document under a folder, as one CSV or as JSON, every row with the file and the section it stands in, and `skillcdn code` prints the code blocks as written; `--heading` keeps what stands under a heading, `--out` writes a file, `code --grep` filters by a pattern on this machine. The same is `GET /api/v1/rows/<address>` (`format=csv` for one CSV) and `GET /api/v1/code/<address>`, registered by `registerAddressRoutes` and read by the client's `rows` and `code`. The reader gains `rows` and `code`, and a mount may say where its data is had (`dataUrl`); the outline of a document says how many tables, rows and code blocks it holds and where they are had, and a heading how many rows its section holds (`tables`, `codeBlocks`, `data` and `rows` over REST). `core` exports `dataOfMarkdown`, `toCsv`, `rowsBody`, `codeBody`, `rowsCsv`, the schemas and the limits.

- [`dc29485`](https://github.com/skillcdn/skillcdn/commit/dc29485912bc71c7685838719782d4528f44b7d8) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn embed <directory>` embeds the sections of a directory's documents ahead of the first search, with the server `EMBEDDINGS_URL` and `EMBEDDINGS_MODEL` name, and keeps the vectors in the cache: a `find`, an `mcp` or a `serve` afterwards ranks by words and meaning at once. On standard error it says how many documents there are and, every fifteen seconds at the most, how many are done and about how long is left, which every command that embeds now says in place of a line per hundred documents; it exits `2` when the server failed, with what it embedded kept. While the embedding of an index goes on, a search by words and meaning says how far it is: the ranking line ends `; 123 of 380 documents embedded so far.`, and `FindRanking` and the REST `ranking` gain the optional `embedding`.
- Updated dependencies [[`4cd8d35`](https://github.com/skillcdn/skillcdn/commit/4cd8d35cf19062346274a84f5a40bb56aec9931f), [`67c8df3`](https://github.com/skillcdn/skillcdn/commit/67c8df37c41c15f55bbe3016ebbc9a1c3f96831d), [`9b72da2`](https://github.com/skillcdn/skillcdn/commit/9b72da22ee37ec22bb1133825a4795b112db031b), [`fd7d61d`](https://github.com/skillcdn/skillcdn/commit/fd7d61d6e3e34086106cfc227e843a6bf25087fa), [`85264e1`](https://github.com/skillcdn/skillcdn/commit/85264e13a79dd400aae63be18c231b385f22bb23), [`18f1bae`](https://github.com/skillcdn/skillcdn/commit/18f1baeffd01f766da55f37161bbf603ba046a51), [`2cba1c0`](https://github.com/skillcdn/skillcdn/commit/2cba1c0f62bca1a2fc610223863698e4ff5359fd), [`dc29485`](https://github.com/skillcdn/skillcdn/commit/dc29485912bc71c7685838719782d4528f44b7d8), [`ca30bdf`](https://github.com/skillcdn/skillcdn/commit/ca30bdf165cc03632c619852a53c287c5486f720)]:
  - @skillcdn/core@0.5.0
  - @skillcdn/indexer@0.5.0
  - @skillcdn/reader@0.5.0
  - @skillcdn/serve@0.5.0
  - @skillcdn/client@0.5.0
  - @skillcdn/inference@0.5.0

## 0.4.2

### Patch Changes

- [`728f791`](https://github.com/skillcdn/skillcdn/commit/728f791d3ec4e1497f0d0d6f2c2b6216ed4cfdcb) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A refused read of a file of a pack served from a directory, over MCP, over REST and by the command, no longer tells the reader to fetch it with a GitHub credential: the line that names the credential follows only for a private repository of a git host, which has one to ask. `MountSummary` may name the `host` of its address, which the reader's summaries and `mountSummaryOf` now do, and `accessHint` and `describeSource` read it; a summary without it is read as a git host's.
- Updated dependencies [[`b3bb896`](https://github.com/skillcdn/skillcdn/commit/b3bb896785a8e3e8298dd025c816303a36d4c552), [`b8f2413`](https://github.com/skillcdn/skillcdn/commit/b8f241303a02e856dbfd1baac6aa4190635a5a72), [`728f791`](https://github.com/skillcdn/skillcdn/commit/728f791d3ec4e1497f0d0d6f2c2b6216ed4cfdcb), [`8aee133`](https://github.com/skillcdn/skillcdn/commit/8aee13321eb11e4341b11f8542d93e68d911cd70), [`284f15d`](https://github.com/skillcdn/skillcdn/commit/284f15d9833dfb7de2e5c5b60150ded713b17285)]:
  - @skillcdn/serve@0.4.2
  - @skillcdn/reader@0.4.2
  - @skillcdn/core@0.4.2
  - @skillcdn/client@0.4.2
  - @skillcdn/indexer@0.4.2
  - @skillcdn/inference@0.4.2

## 0.4.1

### Patch Changes

- [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A pack carries the originals its documents were made from and the pictures they show, and a read of such a file ends in a link that opens (ADR-0076, ADR-0077).
  
  - `@skillcdn/core`: `isBinaryPath` and `isImagePath` know a file by its extension; `parseLfsPointer` reads a Git LFS pointer; `lfsFileUrl` and `localRawFileUrl` name where a host serves a file kept in LFS and where a deployment serves the files of a directory pack, and `rawFileUrl` of a `local` repository is now that route, `/api/v1/raw/<address>?path=`, instead of the page of the file; `inspectMarkdownLinks` lists a document's references, pictures with their alternative text, and links to other files, and `resolveLocalLink` resolves any local destination; `documentSources` and `resolveDocumentSource` read a document's front-matter `source`. A `FileOutline` may carry the document's `images` and `sources`, a `FileResult` its `sources` on the first page, a `BrowseResult` the `manifestPath` of the folder, a directory `BrowseEntry` its `imageCount`, a document `FindItem` `overview: true` when it is the README of its folder, and a `not_text` lookup `lfs` with the size of the file a pointer stands for; the REST schemas take the same fields, all optional. `accessHint` and `describeSource` write the line a refused read ends with, which names the credential a private repository's file needs. `searchFieldsOf` takes the headings of a document, weighed with the words of the path, above the body. The rendered results say all of this: the manifest of a folder, the pictures of a folder, the originals and pictures of a document, a map among search results.
  - `@skillcdn/indexer`: reading rules version 13. The headings of a document weigh above its body; a local link that names no file, a picture without alternative text, a picture or an original that is not there, and a skill's reference to a file that is not text are diagnostics. The bodies the store lacks are fetched in one archive before the rounds, only when the archive is not much larger than what is needed, so that a pack full of originals is read file by file and its originals are never downloaded. `readWorkingTree` reads with the tree only the files the reading rules read as text; every other file is listed with a stand-in hash from its path, size and modification time, with `bytes` left out as for a file over the limits, and read from disk through `read` when its bytes are asked for; `bytesOf` reads either, `openWorkingTreeFile` opens a file of a tree to be streamed as it is, and `readDirectory` answers `readBlob`. `check` says of a directory without a license that a directory is served in full, and what a deployment would do.
  - `@skillcdn/reader`: a file whose name says that it is not text is never fetched to learn that, unless it is small enough to be a Git LFS pointer; a body the store holds and does not read as text is not fetched again; a body fetched and found not to be text is remembered in the process, since its bytes are not kept. A read of a pointer answers where the mount's `lfsUrl`, new on `MountContext` and optional, serves the file. `rawFile` says whether a file of a mount is served, for whoever sends its bytes. Outlines carry a document's pictures and originals on their first page, a file its originals on its first page, a folder its manifest, and a search result marks the README of a folder as its overview.
  - `@skillcdn/serve`: `GET /api/v1/raw/<address>?path=` sends a served file as an attachment from the `rawFile` the app gives the routes, with `rawFileHeaders`, and sends the reader on to the source with a redirect where it has none; over HTTP `createLocalApp` names that route, at the origin asked at, as the source of every file (`mountServedAt`). A refused read of a private repository's file says how to fetch it, and a Git LFS pointer where the host serves the file.
  - `@skillcdn/cli`: a picture or an original of a directory is answered with its `file:` URL by the reading commands and over standard input and output, whatever its size, and from the server's own raw route over HTTP, where `skillcdn serve` sends the file itself; a served directory deleted and made anew in the same place is watched and read again.
- Updated dependencies [[`9797873`](https://github.com/skillcdn/skillcdn/commit/979787324d4367f81539f7fc1c070a4f34f3c2ec), [`0f51e91`](https://github.com/skillcdn/skillcdn/commit/0f51e912a1e5da13c97464f708f122fac9444254), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f), [`14e1d39`](https://github.com/skillcdn/skillcdn/commit/14e1d39b30ebacaa0e16c78b9c3c31e27befd63b), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f), [`0f51e91`](https://github.com/skillcdn/skillcdn/commit/0f51e912a1e5da13c97464f708f122fac9444254)]:
  - @skillcdn/inference@0.4.1
  - @skillcdn/core@0.4.1
  - @skillcdn/indexer@0.4.1
  - @skillcdn/reader@0.4.1
  - @skillcdn/serve@0.4.1
  - @skillcdn/client@0.4.1

## 0.4.0

### Patch Changes

- [`95c13d0`](https://github.com/skillcdn/skillcdn/commit/95c13d0229f5102de02e201b43a498bb8a4e8f76) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A page of a file lists the links within it, not the first links of the whole file: a section read by its offset and limit is no longer followed by references to other parts of the document. A page that delivered the length it was asked for says where the file continues ("The file continues at offset N.") instead of telling the reader that more follows, since a section read is complete at its end; "More follows" is kept for a page the response budget cut short of what was asked. The file result carries the requested length as requestedLength for the renderer to tell the two apart.

- [`57f0ad6`](https://github.com/skillcdn/skillcdn/commit/57f0ad6aa0ab3c6f4fd092d6923d7650367a9e6e) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Each word of a query weighs by its rarity among the entries searched: a code, a number or a name that few documents hold decides the order, a word every document repeats decides next to nothing, and the sections of a document are ranked with the same weights. `rankSearchVector` and `matchSections` take the weights, `queryWeights` makes them from how many entries hold each word, and the `IndexStore` port gains `frequencies(path, lexemes)`, which the memory index answers; a store that does not count leaves it out and ranks as before. A match in a name now counts twice a match in the body, no more (`SEARCH_WEIGHTS` 1.0, 0.85, 0.7, 0.5 for the name, the description, the path and the body). A hyphenated code with a digit part, or across scripts (`OIW-PV-120`, `6635-81-302-5518`, `서돌-4`), is a word of the search vector beside its parts, so that the code finds the one document that holds it; the reading rules are at version 12 for it, and a deployment rebuilds its indexes as they are next asked for.

- [`a9da901`](https://github.com/skillcdn/skillcdn/commit/a9da901f2a4a6b0f28a5e590e2214b8d700bb710) Thanks [@samo-lucid](https://github.com/samo-lucid)! - Breaking: packs of documents are served through their structure and their words (ADR-0063, phase A).
  
  - A search result names the sections of a document that matched: the heading path, the `offset` and `limit` that read the section with `read_repo_file`, and an excerpt, left out when it only repeats the document's summary. `FindItem` documents carry `sections`; the REST `find` body carries them as `sections` with a nullable `excerpt`.
  - `browse_repo` given a file path answers the file's outline: every heading with its level, text, offset and the length of its section, paged. `BrowseResult` carries `outline` (`FileOutline`) and the REST `browse` body carries `outline`.
  - The word rules read the scripts without word stems (Han, Hangul, Hiragana, Katakana) by pairs of characters, and a pack's `language` chooses the stemmer, English being the only one at present: `searchLexemes`, `queryLexemes` and `searchVectorOf` take a language, and `wordRulesOf` names the rules.
  - The search vector is built by the indexer and stored as it is: `IndexEntry.search` holds it in the text form of a PostgreSQL `tsvector` (`serializeSearchVector`, `parseSearchVector`, `serializeSearchQuery`), and `IndexEntry.searchBody` is gone. `IndexStore.search` takes the lexemes of a query instead of the query. The reading rules are version 11, so a deployment rebuilds the indexes it holds when they are next asked for.
  - New in `@skillcdn/core`: `outlineMarkdown`, `headingPaths`, `matchSections`, and the result types and REST schemas of sections and outlines.
  - The `skillcdn` command outlines a file with `browse <pack> <file>`, prints the sections a search matched, and `check` prints how many sections each document has.

- [`6fc2261`](https://github.com/skillcdn/skillcdn/commit/6fc2261373a85bebf3f3a66d3dade3382b8550be) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The command searches a directory by meaning as well as by words, given the variables a deployment takes (ADR-0064): with `EMBEDDINGS_URL` and `EMBEDDINGS_MODEL`, `find`, `mcp` and `serve` embed the sections of the directory's documents with that server, as a deployment embeds them, and a result says it was ranked by words and meaning; `RERANKER_URL` and `RERANKER_MODEL` rerank the first results. The vectors are kept in the cache directory (`~/.cache/skillcdn`, or under `XDG_CACHE_HOME`) by the hash of each file, under the model's name and dimensions, so that a directory is embedded once on a machine and a changed file again; a manifest's `search: { meaning: false }` keeps its documents to the words. A served directory answers by words alone until its vectors arrive, `find` waits for them, and a read without words calls no server. A server that does not answer leaves the words to answer, with a line on standard error. Exit code `78` now covers every variable the command reads, not the limit variables alone.
- Updated dependencies [[`cd9e11c`](https://github.com/skillcdn/skillcdn/commit/cd9e11c78a468df5cb546b2936a86fea32e7a204), [`b6ae700`](https://github.com/skillcdn/skillcdn/commit/b6ae700f79f0aebffff60b31cd2a25841c8c0ec7), [`95c13d0`](https://github.com/skillcdn/skillcdn/commit/95c13d0229f5102de02e201b43a498bb8a4e8f76), [`8d532fe`](https://github.com/skillcdn/skillcdn/commit/8d532fe5e5c6dab381f6985e30bf4f5180c8fd93), [`daabd7f`](https://github.com/skillcdn/skillcdn/commit/daabd7fbba1feba480f07f8be7262c1825c64980), [`5f1c0fc`](https://github.com/skillcdn/skillcdn/commit/5f1c0fc271d72807f45944fc45cb32f810e67a9a), [`0e2052c`](https://github.com/skillcdn/skillcdn/commit/0e2052c306625d0ebe75513c5e0ada3b4e23e5b5), [`64a6809`](https://github.com/skillcdn/skillcdn/commit/64a6809986b099cc4b098d5cb4dde1be30a7c711), [`7bd391d`](https://github.com/skillcdn/skillcdn/commit/7bd391d54aa43659ee47c3adba9c18f4819d3886), [`5887911`](https://github.com/skillcdn/skillcdn/commit/58879117dce4539aa4746b4f30f3ad159a0c94bc), [`9654820`](https://github.com/skillcdn/skillcdn/commit/9654820d3998cd6bd13e57f806d3c34100ee8090), [`57f0ad6`](https://github.com/skillcdn/skillcdn/commit/57f0ad6aa0ab3c6f4fd092d6923d7650367a9e6e), [`4290804`](https://github.com/skillcdn/skillcdn/commit/42908040e0f255c71e5987470f260c746a9ca4a5), [`812407f`](https://github.com/skillcdn/skillcdn/commit/812407f7cff74f3973bf40ae25ef3310edb2ba0f), [`95c13d0`](https://github.com/skillcdn/skillcdn/commit/95c13d0229f5102de02e201b43a498bb8a4e8f76), [`a9da901`](https://github.com/skillcdn/skillcdn/commit/a9da901f2a4a6b0f28a5e590e2214b8d700bb710), [`23c5656`](https://github.com/skillcdn/skillcdn/commit/23c56560c7a474a308929e0dad0975d8798f9481), [`4f63a73`](https://github.com/skillcdn/skillcdn/commit/4f63a73adf5a3afdbbe9ae1dfe7ef6e4b7dd39d3), [`4290804`](https://github.com/skillcdn/skillcdn/commit/42908040e0f255c71e5987470f260c746a9ca4a5), [`a62f704`](https://github.com/skillcdn/skillcdn/commit/a62f704ae441dfed59e188e584eaee54a1d26c43), [`e619aff`](https://github.com/skillcdn/skillcdn/commit/e619aff434e378dc0ec4d5f212d891e042981b06), [`4f63a73`](https://github.com/skillcdn/skillcdn/commit/4f63a73adf5a3afdbbe9ae1dfe7ef6e4b7dd39d3), [`82a10cc`](https://github.com/skillcdn/skillcdn/commit/82a10ccfb756897a0913bc5c7bc84012171d6689), [`7445571`](https://github.com/skillcdn/skillcdn/commit/74455715429a17389c9c6adfbfc448024bd9468b), [`8dbdc10`](https://github.com/skillcdn/skillcdn/commit/8dbdc10ff3aa3598b244c6c754f2f6f5e0981815), [`966a1b4`](https://github.com/skillcdn/skillcdn/commit/966a1b4222021aa217864bbedbe10fafa7c909be)]:
  - @skillcdn/core@0.4.0
  - @skillcdn/serve@0.4.0
  - @skillcdn/client@0.4.0
  - @skillcdn/indexer@0.4.0
  - @skillcdn/reader@0.4.0
  - @skillcdn/inference@0.4.0

## 0.3.1

### Patch Changes

- [`73c80b1`](https://github.com/skillcdn/skillcdn/commit/73c80b1c83894a33f9f35405a687eeb708f605c2) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A command connects to a deployment with a code a person approves, and receives a repository token it never shows (ADR-0059). `@skillcdn/core` has the contract: the routes under `/api/v1/connect`, the schemas of what is sent and answered (`restConnectRequestSchema`, `restConnectStartedSchema`, `restConnectViewSchema`, `restConnectDecisionSchema`, `restConnectDecidedSchema`, `restConnectClaimSchema`, `restConnectClaimedSchema`), the code's alphabet and `parseConnectCode`, which reads a code back however a person typed it, and `connectPagePath`, the page where it is approved. `@skillcdn/client` has the four calls: `connect` begins and `claimConnection` claims, as nobody; `connection` reads what asks and `decideConnection` answers it, as the person signed in.
  
  The `skillcdn` command connects that way: `skillcdn login --url <origin> gh/<owner>/<repo>` (the address left out in a directory bound to the pack) prints the deployment's page for a code and the code, waits for the approval and keeps the repository token it is handed, never showing it; `--agent` says what it calls itself on that page, else the agent it runs under and the machine. `--token-stdin` stays for a token made by hand, asked for without echo at a terminal and piped in by a job. Tokens are kept per deployment and repository, and a read presents the one kept for the repository it reads, else the one kept for the deployment alone; `logins` names them, and `logout --url <origin> [<address>]` forgets them. `skillcdn use <directory>` binds a checkout to a pack on this machine, read with no deployment and no token, beside `use <address>`, and `use` prints the sentence for the checkout's agreement that tells the agents working there to read the pack. `skillcdn status` says what the directory reads and where, whether a token is kept for it, and the command's version, without reading anything.
- Updated dependencies [[`73c80b1`](https://github.com/skillcdn/skillcdn/commit/73c80b1c83894a33f9f35405a687eeb708f605c2)]:
  - @skillcdn/core@0.3.1
  - @skillcdn/client@0.3.1
  - @skillcdn/indexer@0.3.1
  - @skillcdn/reader@0.3.1
  - @skillcdn/serve@0.3.1

## 0.3.0

### Minor Changes

- [`06142b2`](https://github.com/skillcdn/skillcdn/commit/06142b2ee1a969e855ead68563fa89949b749a16) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `@skillcdn/client` is the REST API of a deployment as typed functions (ADR-0056): `createClient` gives one function per route, every answer parsed with the schemas of `@skillcdn/core`, every failure an `ApiError` with the API's code, a token sent as the bearer to one origin and no redirect followed; `whenIndexed` waits for a commit's index and `skillPages` reads a skill page after page. The `skillcdn` command reads a pack at a deployment through it: `skills`, `browse`, `find`, `skill` and `file` take an address (`gh/<owner>/<repo>[@ref][/path]`, a URL at a deployment, or a `skill://` URI) as well as a directory, at `--url`, `SKILLCDN_URL`, the deployment the directory is bound to, or `https://skillcdn.ai`; `login --url <origin> --token-stdin`, `logout` and `logins` keep a token per deployment that goes nowhere else, `SKILLCDN_URL` with `SKILLCDN_TOKEN` does the same for one run, and `use <address> [--url <origin>]` binds a directory to a pack with `.skillcdn.json`, so that a read there needs no pack argument.

- [`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The `skillcdn` command reads a pack as an agent gets it over MCP, from a directory on this machine (ADR-0055): `skillcdn skills <directory>` prints what a client is told on connect and every skill and document, `browse`, `find`, `skill` and `file` print what `browse_repo`, `search_repo`, `load_skill` and `read_repo_file` give a model, rendered by the same functions with the reads named as the commands, or the JSON of the REST API with `--json`. A skill is printed whole. The directory is addressed as `local/<its parent>/<its name>`, or as `--as` says, and is verified. `@skillcdn/indexer` exports `readDirectory`, which reads a directory as the indexer reads a commit and which `check` now reads through; `@skillcdn/reader` exports `createMemoryIndex`, an index kept in memory and searched with the word rules of `@skillcdn/core`; the renderers of `@skillcdn/core` take `ToolWords`, the names of the four reads, with `MCP_TOOL_WORDS` as their default.

- [`76cc577`](https://github.com/skillcdn/skillcdn/commit/76cc5777c614a2965a10ad8ed598e884636fed4f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `@skillcdn/serve` is the edges of SkillCDN as a library (ADR-0057): `createMountServer` makes the MCP server of a mount, the four tools, the prompt and the skills extension over a reader, with what a deployment counts as optional hooks; `registerAddressRoutes` puts the five routes of the REST API that read an address on any Hono app; `createLocalApp`, `listenOn` and `serveOverStdio` serve mounts from a machine. The `skillcdn` command serves a directory with it: `skillcdn mcp <directory>` to the agent at the other end of standard input and output, and `skillcdn serve <directory>...` over HTTP on this machine, each directory at its `local/<owner>/<name>` address with the REST routes beside it, read again when its files change.

### Patch Changes

- Updated dependencies [[`06142b2`](https://github.com/skillcdn/skillcdn/commit/06142b2ee1a969e855ead68563fa89949b749a16), [`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909), [`5a009f1`](https://github.com/skillcdn/skillcdn/commit/5a009f13e65baaed5c619d4c120d61f51d54bd38), [`475a68f`](https://github.com/skillcdn/skillcdn/commit/475a68f8bc59a73e03f49d11df990c6ec243a779), [`036386e`](https://github.com/skillcdn/skillcdn/commit/036386ed19592aa4f0b76e1289b2ef2293451d83), [`fd0f1ad`](https://github.com/skillcdn/skillcdn/commit/fd0f1adc7fc5490d198ca7e2f5e263434f4d0a8c), [`4e6b137`](https://github.com/skillcdn/skillcdn/commit/4e6b137e29c1a1e637f81a0edcd21702bf47e2dd), [`76cc577`](https://github.com/skillcdn/skillcdn/commit/76cc5777c614a2965a10ad8ed598e884636fed4f)]:
  - @skillcdn/client@0.3.0
  - @skillcdn/indexer@0.3.0
  - @skillcdn/reader@0.3.0
  - @skillcdn/core@0.3.0
  - @skillcdn/serve@0.3.0

## 0.1.4

### Patch Changes

- [`fb4bc97`](https://github.com/skillcdn/skillcdn/commit/fb4bc975187b502401ff326619ab90291533a6d2) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The README and the package description call what the command checks a pack, as the SkillCDN Format now does: a git repository of skills, documents and rules, served whole. Nothing about the command changed.

## 0.1.3

### Patch Changes

- [`411baec`](https://github.com/skillcdn/skillcdn/commit/411baecb6fb14c10b36dff6c19576b7f876b00c2) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The README shows the SkillCDN symbol from `@skillcdn/brand`, the package the brand files now live in.
- Updated dependencies [[`2a62df4`](https://github.com/skillcdn/skillcdn/commit/2a62df4432ea4d57796ec692fc9612f652d67bd7)]:
  - @skillcdn/indexer@0.2.2

## 0.1.2

### Patch Changes

- [`5a2db5a`](https://github.com/skillcdn/skillcdn/commit/5a2db5a2eb1ece9268d6cb41abf43a9d1d820f34) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn check` ends quietly when whatever reads its output stops early (`skillcdn check | head`), instead of failing with a broken-pipe error.

- [`76a9e4e`](https://github.com/skillcdn/skillcdn/commit/76a9e4e01289ce41f214db143b1a3f5512fc6ac9) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The README opens with the SkillCDN symbol, the command's one-line description and its badges: the version on npm, the Node.js it needs, the state of CI, the license.
- Updated dependencies [[`76a9e4e`](https://github.com/skillcdn/skillcdn/commit/76a9e4e01289ce41f214db143b1a3f5512fc6ac9)]:
  - @skillcdn/indexer@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`ad29c0c`](https://github.com/skillcdn/skillcdn/commit/ad29c0c83287a1ab617ba36e873080ffacbb30ce)]:
  - @skillcdn/indexer@0.2.0
