# @skillcdn/core

## 0.3.1

### Patch Changes

- [`73c80b1`](https://github.com/skillcdn/skillcdn/commit/73c80b1c83894a33f9f35405a687eeb708f605c2) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A command connects to a deployment with a code a person approves, and receives a repository token it never shows (ADR-0059). `@skillcdn/core` has the contract: the routes under `/api/v1/connect`, the schemas of what is sent and answered (`restConnectRequestSchema`, `restConnectStartedSchema`, `restConnectViewSchema`, `restConnectDecisionSchema`, `restConnectDecidedSchema`, `restConnectClaimSchema`, `restConnectClaimedSchema`), the code's alphabet and `parseConnectCode`, which reads a code back however a person typed it, and `connectPagePath`, the page where it is approved. `@skillcdn/client` has the four calls: `connect` begins and `claimConnection` claims, as nobody; `connection` reads what asks and `decideConnection` answers it, as the person signed in.
  
  The `skillcdn` command connects that way: `skillcdn login --url <origin> gh/<owner>/<repo>` (the address left out in a directory bound to the pack) prints the deployment's page for a code and the code, waits for the approval and keeps the repository token it is handed, never showing it; `--agent` says what it calls itself on that page, else the agent it runs under and the machine. `--token-stdin` stays for a token made by hand, asked for without echo at a terminal and piped in by a job. Tokens are kept per deployment and repository, and a read presents the one kept for the repository it reads, else the one kept for the deployment alone; `logins` names them, and `logout --url <origin> [<address>]` forgets them. `skillcdn use <directory>` binds a checkout to a pack on this machine, read with no deployment and no token, beside `use <address>`, and `use` prints the sentence for the checkout's agreement that tells the agents working there to read the pack. `skillcdn status` says what the directory reads and where, whether a token is kept for it, and the command's version, without reading anything.

## 0.3.0

### Minor Changes

- [`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The `skillcdn` command reads a pack as an agent gets it over MCP, from a directory on this machine (ADR-0055): `skillcdn skills <directory>` prints what a client is told on connect and every skill and document, `browse`, `find`, `skill` and `file` print what `browse_repo`, `search_repo`, `load_skill` and `read_repo_file` give a model, rendered by the same functions with the reads named as the commands, or the JSON of the REST API with `--json`. A skill is printed whole. The directory is addressed as `local/<its parent>/<its name>`, or as `--as` says, and is verified. `@skillcdn/indexer` exports `readDirectory`, which reads a directory as the indexer reads a commit and which `check` now reads through; `@skillcdn/reader` exports `createMemoryIndex`, an index kept in memory and searched with the word rules of `@skillcdn/core`; the renderers of `@skillcdn/core` take `ToolWords`, the names of the four reads, with `MCP_TOOL_WORDS` as their default.

- [`5a009f1`](https://github.com/skillcdn/skillcdn/commit/5a009f13e65baaed5c619d4c120d61f51d54bd38) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The reads of a mount are a package, `@skillcdn/reader`, over the `IndexStore` port that `@skillcdn/core` now defines (`IndexStore`, `ReadableIndex`, `IndexOutcome`), so that the same reads answer from an index wherever it is kept (ADR-0054). `Reader` takes a `MountContext` and the index the caller answers, and gives the results the MCP tools and the REST bodies are written from: `catalog`, `overview`, `browse`, `find`, `skill`, `file`, and the skills extension's `listSkills`, `getSkill`, `readResource` and `readDirectory`.

- [`475a68f`](https://github.com/skillcdn/skillcdn/commit/475a68f8bc59a73e03f49d11df990c6ec243a779) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `local` is a host of the address grammar: `/local/<owner>/<name>[/<path>]` names a pack served from a machine by the `skillcdn` command, with no git host behind it, and `skill://local/<owner>/<name>/<path>` names its files (ADR-0053). `ADDRESS_HOST_KEYS` lists every host an address can name and `GIT_HOST_KEYS` stays the git hosts; `Address.host` is now `AddressHost`, and `GitHostAddress`, `isGitHostAddress` and `isGitHostKey` narrow to a git host where one is needed. The REST `repository.host` takes the same values. A deployment serves no `local` address.

- [`036386e`](https://github.com/skillcdn/skillcdn/commit/036386ed19592aa4f0b76e1289b2ef2293451d83) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The bodies of the REST API's address routes are built here from the reader's results (`mountBody`, `browseBody`, `findBody`, `skillOutcome`, `fileBody`, `directoryBody`), and read back as those results (`mountSummaryOf`, `catalogStateOf`, `browseResultOf`, `findResultOf`, `skillResultOf`, `fileResultOf`, `directoryResultOf`), so that a program on the REST API renders what an MCP client's model is given with the same renderers; `joinSkillPages` makes one skill of the pages it was read in. The `skills` and `files` answers name the `commit` they were read from. The outcomes of a read (`IndexNotReady`, `SkillLookup`, `FileLookup`, `IndexedFile`, `MountOverview`, `MountManifest`, `SkillListing`) are types of this package.

- [`4e6b137`](https://github.com/skillcdn/skillcdn/commit/4e6b137e29c1a1e637f81a0edcd21702bf47e2dd) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The word rules of search, so that a pack indexed in memory is searched as a deployment searches one (ADR-0053): `searchLexemes` and `queryLexemes` cut and stem text as PostgreSQL's `english` configuration does, with `stemEnglish` (the Snowball English stemmer) and `ENGLISH_STOP_WORDS`; `searchFieldsOf`, `searchVectorOf` and `rankSearchVector` weigh and rank a document as the deployment's index does, with `SEARCH_WEIGHTS`, `SKILL_RANK_BOOST` and `MAX_SEARCHED_BODY_LENGTH`.

## 0.2.1

### Patch Changes

- [`eb9e6a8`](https://github.com/skillcdn/skillcdn/commit/eb9e6a80712b417cdb5ce3372cf19e87e87ecaa3) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A license text that quotes a permissive license is no longer read as that license. The Functional Source License and the Business Source License name the license they turn into later, and a permissive text with the Commons Clause added quotes the text it conditions; each is now read as the restrictive license it names itself. The Functional Source License is recognized by its text, as `FSL-1.1-ALv2` or `FSL-1.1-MIT` (and as a declared `license` field), and so is the Elastic License 2.0.

- [`35e4ca0`](https://github.com/skillcdn/skillcdn/commit/35e4ca049b126a2b2e4eae572b8ecd83f0e26037) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `DOCS_PAGE_PATH` names where a deployment's pages render the repository's own documentation (`/docs`), and a `SocialCard` may carry an empty `avatar` for a page that has no owner, where the site's symbol stands in its place.

## 0.2.0

### Minor Changes

- [`ac3130a`](https://github.com/skillcdn/skillcdn/commit/ac3130a4ebbb0fb5a0f1ff46b12a70413b8eda12) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `renderBrandBadge` draws the badge of an address as an SVG (the symbol, `SkillCDN` and a fact such as `12 skills`), and `BADGE_ROUTE` names where a deployment serves it.

### Patch Changes

- [`2a62df4`](https://github.com/skillcdn/skillcdn/commit/2a62df4432ea4d57796ec692fc9612f652d67bd7) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `summarizeMarkdown` skips an HTML block whole, to the blank line that ends it (or the closing marker of a comment or a raw-text element), however its lines are indented: a README that opens with a centred `<div>` is introduced by its first paragraph of prose again.

## 0.1.1

### Patch Changes

- [`76a9e4e`](https://github.com/skillcdn/skillcdn/commit/76a9e4e01289ce41f214db143b1a3f5512fc6ac9) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The README opens with the SkillCDN symbol, the package's one-line description and its badges: the version on npm, the state of CI, the license.
