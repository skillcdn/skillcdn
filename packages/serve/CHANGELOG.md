# @skillcdn/serve

## 0.1.0

### Minor Changes

- [`fd0f1ad`](https://github.com/skillcdn/skillcdn/commit/fd0f1adc7fc5490d198ca7e2f5e263434f4d0a8c) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The address routes take the usage hooks the tools take: a read through the REST API is counted as a call of its route (`rest/mounts`, `rest/browse`, `rest/find`, `rest/skills`, `rest/files`), the first page of a skill as a load of the skill, the first page of a file as a read of it, and the client by the product token its user agent begins with (`clientAppOf`; `browser` for a browser), at the address the app resolves for it.

- [`76cc577`](https://github.com/skillcdn/skillcdn/commit/76cc5777c614a2965a10ad8ed598e884636fed4f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `@skillcdn/serve` is the edges of SkillCDN as a library (ADR-0057): `createMountServer` makes the MCP server of a mount, the four tools, the prompt and the skills extension over a reader, with what a deployment counts as optional hooks; `registerAddressRoutes` puts the five routes of the REST API that read an address on any Hono app; `createLocalApp`, `listenOn` and `serveOverStdio` serve mounts from a machine. The `skillcdn` command serves a directory with it: `skillcdn mcp <directory>` to the agent at the other end of standard input and output, and `skillcdn serve <directory>...` over HTTP on this machine, each directory at its `local/<owner>/<name>` address with the REST routes beside it, read again when its files change.

### Patch Changes

- Updated dependencies [[`7dabd75`](https://github.com/skillcdn/skillcdn/commit/7dabd75d1877812c8110700481ab871566df0909), [`5a009f1`](https://github.com/skillcdn/skillcdn/commit/5a009f13e65baaed5c619d4c120d61f51d54bd38), [`475a68f`](https://github.com/skillcdn/skillcdn/commit/475a68f8bc59a73e03f49d11df990c6ec243a779), [`036386e`](https://github.com/skillcdn/skillcdn/commit/036386ed19592aa4f0b76e1289b2ef2293451d83), [`4e6b137`](https://github.com/skillcdn/skillcdn/commit/4e6b137e29c1a1e637f81a0edcd21702bf47e2dd)]:
  - @skillcdn/reader@0.1.0
  - @skillcdn/core@0.3.0
