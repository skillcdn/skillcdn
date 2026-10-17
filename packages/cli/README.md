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

The `skillcdn` command, for two kinds of people. An author runs `skillcdn check` to see what an agent would get from a pack before pushing it. An agent with a shell runs `skillcdn skills`, `browse`, `find`, `skill` and `file` to read a pack as an MCP client's model reads it, without an MCP connection: the same text, from the same reading rules, from a pack at a deployment or from a directory on the machine ([ADR-0055](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0055-the-command-reads-a-pack-as-a-deployment-serves-it.md), [ADR-0056](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)).

```sh
npm install -g @skillcdn/cli                 # or: npx @skillcdn/cli <command> ...
skillcdn check                               # the current directory, before pushing
skillcdn skills gh/acme/skills               # what a client is told on connect, then every skill and document
skillcdn browse gh/acme/skills marketing     # what a folder holds
skillcdn find gh/acme/skills release notes   # what the words find
skillcdn skill gh/acme/skills marketing/ads/SKILL.md   # one skill whole: rules, instructions, included files
skillcdn file gh/acme/skills docs/guide.md   # a page of a file
skillcdn skills ./packs/acme                 # the same from a directory: no server, no network
```

## Reading a pack

A pack is named by its address at a deployment, `gh/<owner>/<repo>[@<ref>][/<path>]`, the URL of the pack at a deployment, or a `skill://` URI; or by a directory on this machine in the [SkillCDN Format](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md), a git checkout or any folder of skills, documents and rules. An address is read through [`@skillcdn/client`](https://www.npmjs.com/package/@skillcdn/client) at `--url`, else `SKILLCDN_URL`, else the deployment the directory is bound to, else `https://skillcdn.ai`, waiting while a first look at a commit indexes it. A directory is read as the indexer reads a commit and kept as an index in memory ([`@skillcdn/reader`](https://www.npmjs.com/package/@skillcdn/reader)). Either way the reads are a deployment's reads, and what is printed is what the matching tool of [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md) gives a model, with the reads named as the commands; `--json` prints the JSON of the matching route of [the REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) instead.

| Command | Over MCP | What it prints |
|---|---|---|
| `skills [<pack>]` | the connection, and `search_repo` without words | What a client is told on connect, then every skill with the path of its `SKILL.md` and every document outside the skills |
| `browse [<pack>] [<folder>]` | `browse_repo` | What a folder holds: skills, folders with what each holds, files; a page, with `--cursor` to continue and `--limit` |
| `find [<pack>] <words...>` | `search_repo` | What the words find, skills first with their matching files, `--path` to a folder; a page |
| `skill [<pack>] <path>` | `load_skill` | The skill whole: the rules from the root down, the instructions, the included files, then its files and references. The path of its `SKILL.md`, or its `skill://` URI, which names the pack as well |
| `file [<pack>] <path>` | `read_repo_file` | A page of the file as written (`--offset`, `--limit`), or what a folder holds |

Paths start at the pack's root, as `marketing/ads/SKILL.md`, and never leave it. Nothing in a directory is executed; a directory is addressed as `local/<its parent>/<its name>`, or as `--as local/<owner>/<name>` says, and is verified, since the person chose it, so its content is served in full under its license with no provenance notice ([addresses](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/address.md#served-from-a-machine)).

## A private pack, and a bound directory

A private repository is read with a token a person made on their account page at the deployment ([permissions](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/permissions.md#tokens-for-agents-with-nobody-to-sign-in)), kept once with `skillcdn login --url <origin> --token-stdin`, read from standard input and never from an argument. One token per deployment, kept in the person's configuration directory (`~/.config/skillcdn/credentials.json`, or under `XDG_CONFIG_HOME`), readable by them alone where the system can say so; it is presented to that deployment and to no other. `skillcdn logins` names the deployments, never the tokens; `skillcdn logout --url <origin>` forgets one. For a job, `SKILLCDN_URL` and `SKILLCDN_TOKEN` together do the same for one run.

`skillcdn use gh/acme/skills [--url <origin>]` binds the working directory to a pack: it writes `.skillcdn.json`, the address and where it is read, nothing secret, meant to be committed, so that a read there or in a directory below needs no pack argument and every agent working in the checkout reads the same pack.

## Checking a pack

`skillcdn check [directory]` reads a directory the same way and prints what an agent would get: the version of the reading rules it applied, the repository manifest, the license, every skill with its files, its warnings, its license and whether the MCP skills extension lists it, the documents outside the skills, linked references, what is not served, the index diagnostics, and what a client is told on connect. An index diagnostic is something the indexer could not read as intended, with the same reason a deployment shows; a `SKILL.md` whose front-matter is not valid YAML is the usual one. Add it to the repository (`npm install --save-dev @skillcdn/cli`) and run it from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

## Exit codes and limits

`0` done. `1`: for `check`, index diagnostics were found; for a read, the pack does not have what was asked for, or refuses it (no such skill, file or folder; a token the deployment does not take). `2` the pack cannot be read: the directory, or the deployment, which could not be reached or has not indexed the commit in time. `64` a usage error, `78` a limit variable that cannot be read, `70` a failure. A push or a job can be gated on them.

`.git`, `node_modules` and symbolic links are left out of a directory. A working directory is read rather than a commit, so untracked or ignored files can make what is printed differ from what is pushed. The limits a deployment applies can be set through the environment (`INDEX_MAX_FILES`, `INDEX_MAX_FILE_BYTES`, `READ_MAX_FILE_BYTES`, and the others listed in [the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)). The rules themselves are [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer).

Node.js 24 or newer.
