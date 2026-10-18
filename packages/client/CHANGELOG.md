# @skillcdn/client

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
