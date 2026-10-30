# @skillcdn/client

## 0.4.1

### Patch Changes

- Updated dependencies [[`0f51e91`](https://github.com/skillcdn/skillcdn/commit/0f51e912a1e5da13c97464f708f122fac9444254), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f), [`14e1d39`](https://github.com/skillcdn/skillcdn/commit/14e1d39b30ebacaa0e16c78b9c3c31e27befd63b), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f)]:
  - @skillcdn/core@0.4.1

## 0.4.0

### Patch Changes

- [`cd9e11c`](https://github.com/skillcdn/skillcdn/commit/cd9e11c78a468df5cb546b2936a86fea32e7a204) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A deployment is searched across every public pack it serves. `@skillcdn/core` gains the result of such a search (`HubResult`, `HubItem`), its text for a model (`renderHubResult`, `renderHubInstructions`), the `search_packs` tool contract, the REST body and schema of `GET /api/v1/search` (`hubBody`, `restSearchSchema`, `hubResultOf`) and the manifest's `search.hub` field, which keeps a repository out of that search; `@skillcdn/serve` gains `createHubServer`, the MCP server of a deployment's root with the one tool, over a search a deployment provides; `@skillcdn/client` gains `search(query, limit)`.

- [`4290804`](https://github.com/skillcdn/skillcdn/commit/42908040e0f255c71e5987470f260c746a9ca4a5) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `myIndex(address)` reads whether the person signed in administers the repository at the git host, and `indexNow(address)` asks, as one who does, that the repository be indexed now and its documents embedded first, answering whether it was queued or waits in the queue already.
- Updated dependencies [[`cd9e11c`](https://github.com/skillcdn/skillcdn/commit/cd9e11c78a468df5cb546b2936a86fea32e7a204), [`b6ae700`](https://github.com/skillcdn/skillcdn/commit/b6ae700f79f0aebffff60b31cd2a25841c8c0ec7), [`95c13d0`](https://github.com/skillcdn/skillcdn/commit/95c13d0229f5102de02e201b43a498bb8a4e8f76), [`8d532fe`](https://github.com/skillcdn/skillcdn/commit/8d532fe5e5c6dab381f6985e30bf4f5180c8fd93), [`5f1c0fc`](https://github.com/skillcdn/skillcdn/commit/5f1c0fc271d72807f45944fc45cb32f810e67a9a), [`0e2052c`](https://github.com/skillcdn/skillcdn/commit/0e2052c306625d0ebe75513c5e0ada3b4e23e5b5), [`64a6809`](https://github.com/skillcdn/skillcdn/commit/64a6809986b099cc4b098d5cb4dde1be30a7c711), [`7bd391d`](https://github.com/skillcdn/skillcdn/commit/7bd391d54aa43659ee47c3adba9c18f4819d3886), [`5887911`](https://github.com/skillcdn/skillcdn/commit/58879117dce4539aa4746b4f30f3ad159a0c94bc), [`9654820`](https://github.com/skillcdn/skillcdn/commit/9654820d3998cd6bd13e57f806d3c34100ee8090), [`57f0ad6`](https://github.com/skillcdn/skillcdn/commit/57f0ad6aa0ab3c6f4fd092d6923d7650367a9e6e), [`4290804`](https://github.com/skillcdn/skillcdn/commit/42908040e0f255c71e5987470f260c746a9ca4a5), [`a9da901`](https://github.com/skillcdn/skillcdn/commit/a9da901f2a4a6b0f28a5e590e2214b8d700bb710), [`23c5656`](https://github.com/skillcdn/skillcdn/commit/23c56560c7a474a308929e0dad0975d8798f9481), [`4f63a73`](https://github.com/skillcdn/skillcdn/commit/4f63a73adf5a3afdbbe9ae1dfe7ef6e4b7dd39d3), [`a62f704`](https://github.com/skillcdn/skillcdn/commit/a62f704ae441dfed59e188e584eaee54a1d26c43), [`82a10cc`](https://github.com/skillcdn/skillcdn/commit/82a10ccfb756897a0913bc5c7bc84012171d6689), [`7445571`](https://github.com/skillcdn/skillcdn/commit/74455715429a17389c9c6adfbfc448024bd9468b), [`8dbdc10`](https://github.com/skillcdn/skillcdn/commit/8dbdc10ff3aa3598b244c6c754f2f6f5e0981815), [`966a1b4`](https://github.com/skillcdn/skillcdn/commit/966a1b4222021aa217864bbedbe10fafa7c909be)]:
  - @skillcdn/core@0.4.0

## 0.3.1

### Patch Changes

- [`73c80b1`](https://github.com/skillcdn/skillcdn/commit/73c80b1c83894a33f9f35405a687eeb708f605c2) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A command connects to a deployment with a code a person approves, and receives a repository token it never shows (ADR-0059). `@skillcdn/core` has the contract: the routes under `/api/v1/connect`, the schemas of what is sent and answered (`restConnectRequestSchema`, `restConnectStartedSchema`, `restConnectViewSchema`, `restConnectDecisionSchema`, `restConnectDecidedSchema`, `restConnectClaimSchema`, `restConnectClaimedSchema`), the code's alphabet and `parseConnectCode`, which reads a code back however a person typed it, and `connectPagePath`, the page where it is approved. `@skillcdn/client` has the four calls: `connect` begins and `claimConnection` claims, as nobody; `connection` reads what asks and `decideConnection` answers it, as the person signed in.
  
  The `skillcdn` command connects that way: `skillcdn login --url <origin> gh/<owner>/<repo>` (the address left out in a directory bound to the pack) prints the deployment's page for a code and the code, waits for the approval and keeps the repository token it is handed, never showing it; `--agent` says what it calls itself on that page, else the agent it runs under and the machine. `--token-stdin` stays for a token made by hand, asked for without echo at a terminal and piped in by a job. Tokens are kept per deployment and repository, and a read presents the one kept for the repository it reads, else the one kept for the deployment alone; `logins` names them, and `logout --url <origin> [<address>]` forgets them. `skillcdn use <directory>` binds a checkout to a pack on this machine, read with no deployment and no token, beside `use <address>`, and `use` prints the sentence for the checkout's agreement that tells the agents working there to read the pack. `skillcdn status` says what the directory reads and where, whether a token is kept for it, and the command's version, without reading anything.
- Updated dependencies [[`73c80b1`](https://github.com/skillcdn/skillcdn/commit/73c80b1c83894a33f9f35405a687eeb708f605c2)]:
  - @skillcdn/core@0.3.1

## 0.3.0

### Minor Changes

- [`06142b2`](https://github.com/skillcdn/skillcdn/commit/06142b2ee1a969e855ead68563fa89949b749a16) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `@skillcdn/client` is the REST API of a deployment as typed functions (ADR-0056): `createClient` gives one function per route, every answer parsed with the schemas of `@skillcdn/core`, every failure an `ApiError` with the API's code, a token sent as the bearer to one origin and no redirect followed; `whenIndexed` waits for a commit's index and `skillPages` reads a skill page after page. The `skillcdn` command reads a pack at a deployment through it: `skills`, `browse`, `find`, `skill` and `file` take an address (`gh/<owner>/<repo>[@ref][/path]`, a URL at a deployment, or a `skill://` URI) as well as a directory, at `--url`, `SKILLCDN_URL`, the deployment the directory is bound to, or `https://skillcdn.ai`; `login --url <origin> --token-stdin`, `logout` and `logins` keep a token per deployment that goes nowhere else, `SKILLCDN_URL` with `SKILLCDN_TOKEN` does the same for one run, and `use <address> [--url <origin>]` binds a directory to a pack with `.skillcdn.json`, so that a read there needs no pack argument.

### Patch Changes

- Updated dependencies [[`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909), [`5a009f1`](https://github.com/skillcdn/skillcdn/commit/5a009f13e65baaed5c619d4c120d61f51d54bd38), [`475a68f`](https://github.com/skillcdn/skillcdn/commit/475a68f8bc59a73e03f49d11df990c6ec243a779), [`036386e`](https://github.com/skillcdn/skillcdn/commit/036386ed19592aa4f0b76e1289b2ef2293451d83), [`4e6b137`](https://github.com/skillcdn/skillcdn/commit/4e6b137e29c1a1e637f81a0edcd21702bf47e2dd)]:
  - @skillcdn/core@0.3.0
