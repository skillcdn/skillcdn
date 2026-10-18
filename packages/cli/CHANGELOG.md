# @skillcdn/cli

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
