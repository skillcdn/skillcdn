<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/cli</h1>
<p align="center">The <code>skillcdn</code> command: check a pack before pushing, and read a pack as an agent gets it over MCP.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/cli"></a>
  <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="node" src="https://img.shields.io/node/v/@skillcdn/cli"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

The `skillcdn` command, for two kinds of people. An author runs `skillcdn check` to see what an agent would get from a pack before pushing it. An agent with a shell runs `skillcdn skills`, `browse`, `find`, `skill` and `file` to read a pack as an MCP client's model reads it, without an MCP connection: the same text, from the same reading rules, from a directory on the machine ([ADR-0055](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0055-the-command-reads-a-pack-as-a-deployment-serves-it.md)).

```sh
npm install -g @skillcdn/cli                 # or: npx @skillcdn/cli <command> ...
skillcdn check                               # the current directory, before pushing
skillcdn skills ./packs/acme                 # what a client is told on connect, then every skill and document
skillcdn browse ./packs/acme marketing       # what a folder holds
skillcdn find ./packs/acme release notes     # what the words find
skillcdn skill ./packs/acme marketing/ads/SKILL.md   # one skill whole: rules, instructions, included files
skillcdn file ./packs/acme docs/guide.md     # a page of a file
```

## Reading a pack

A pack is a directory in the [SkillCDN Format](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md): a git checkout, or any folder of skills, documents and rules. The command reads it as the indexer reads a commit, keeps the index in memory, and answers from it with the reader a deployment answers with ([`@skillcdn/reader`](https://www.npmjs.com/package/@skillcdn/reader)). What it prints is what the matching tool of [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md) gives a model, with the reads named as the commands; `--json` prints the JSON of the matching route of [the REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) instead.

| Command | Over MCP | What it prints |
|---|---|---|
| `skills <directory>` | the connection, and `search_repo` without words | What a client is told on connect, then every skill with the path of its `SKILL.md` and every document outside the skills |
| `browse <directory> [<folder>]` | `browse_repo` | What a folder holds: skills, folders with what each holds, files; a page, with `--cursor` to continue and `--limit` |
| `find <directory> <words...>` | `search_repo` | What the words find, skills first with their matching files, `--path` to a folder; a page |
| `skill <directory> <path>` | `load_skill` | The skill whole: the rules from the root down, the instructions, the included files, then its files and references. The path of its `SKILL.md`, or its `skill://` URI |
| `file <directory> <path>` | `read_repo_file` | A page of the file as written (`--offset`, `--limit`), or what a folder holds |

Paths start at the pack's root, as `marketing/ads/SKILL.md`, and never leave it. The directory is addressed as `local/<its parent>/<its name>`, or as `--as local/<owner>/<name>` says; it is verified, since the person chose it, so its content is served in full under its license with no provenance notice ([addresses](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/address.md#served-from-a-machine)). Nothing in the directory is executed.

## Checking a pack

`skillcdn check [directory]` reads a directory the same way and prints what an agent would get: the version of the reading rules it applied, the repository manifest, the license, every skill with its files, its warnings, its license and whether the MCP skills extension lists it, the documents outside the skills, linked references, what is not served, the index diagnostics, and what a client is told on connect. An index diagnostic is something the indexer could not read as intended, with the same reason a deployment shows; a `SKILL.md` whose front-matter is not valid YAML is the usual one. Add it to the repository (`npm install --save-dev @skillcdn/cli`) and run it from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

## Exit codes and limits

`0` done. `1`: for `check`, index diagnostics were found; for a read, the pack does not have what was asked for (no such skill, file or folder). `2` the directory cannot be read. `64` a usage error, `78` a limit variable that cannot be read, `70` a failure. A push or a job can be gated on them.

`.git`, `node_modules` and symbolic links are left out. A working directory is read rather than a commit, so untracked or ignored files can make what is printed differ from what is pushed. The limits a deployment applies can be set through the environment (`INDEX_MAX_FILES`, `INDEX_MAX_FILE_BYTES`, `READ_MAX_FILE_BYTES`, and the others listed in [the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)). The rules themselves are [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer).

Node.js 24 or newer.
