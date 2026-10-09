<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/cli</h1>
<p align="center">The <code>skillcdn</code> command: check a skill repository before pushing, as SkillCDN would index it.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/cli"></a>
  <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="node" src="https://img.shields.io/node/v/@skillcdn/cli"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

The `skillcdn` command. It does one thing for now: `skillcdn check` reads a directory as [SkillCDN](https://skillcdn.ai) would index it and prints what an agent would get, so that the author of a skill repository sees it before pushing.

```sh
npx @skillcdn/cli check                      # the current directory
pnpm dlx @skillcdn/cli check path/to/repository
```

Or add it to the repository (`npm install --save-dev @skillcdn/cli`) and run `skillcdn check` from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

## What it prints

First the version of the reading rules it applied, so that a report can be told apart from one made under other rules. Then the repository manifest, the license, every skill with its files, its warnings, its license and whether the MCP skills extension lists it, the documents outside the skills, linked references, what is not served, the index diagnostics, and the instructions a client is told on connect. An index diagnostic is something the indexer could not read as intended, with the same reason a deployment shows; a `SKILL.md` whose front-matter is not valid YAML is the usual one.

Exit codes: `0` when there are no index diagnostics, `1` when there are, `2` when the directory cannot be read, so a push or a job can be gated on it. `64` is a usage error and `78` a limit variable that cannot be read.

Nothing in the directory is executed. `.git`, `node_modules` and symbolic links are left out. It reads a working directory rather than a commit, so untracked or ignored files can make its report differ from what is pushed.

The limits a deployment applies can be set through the environment (`INDEX_MAX_FILES`, `INDEX_MAX_FILE_BYTES`, `READ_MAX_FILE_BYTES`, and the others listed in [the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)). The rules themselves are [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer), and the repository format is specified in [skill-repo.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md).

Node.js 24 or newer.
