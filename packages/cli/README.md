<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/cli</h1>
<p align="center">The <code>skillcdn</code> command: check a pack before pushing, read a pack as an agent gets it over MCP, and serve a directory to MCP clients.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/cli"></a>
  <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="node" src="https://img.shields.io/node/v/@skillcdn/cli"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

The `skillcdn` command, for two kinds of people. An author runs `skillcdn check` to see what an agent would get from a pack before pushing it. An agent with a shell runs `skillcdn skills`, `browse`, `find`, `skill` and `file` to read a pack as an MCP client's model reads it, without an MCP connection: the same text, from the same reading rules, from a pack at a deployment or from a directory on the machine ([ADR-0055](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0055-the-command-reads-a-pack-as-a-deployment-serves-it.md), [ADR-0056](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)). Either runs `skillcdn mcp` or `skillcdn serve` to serve a directory as a deployment would, to the MCP client that started the command or to any client on the machine, where there is no deployment or the pack is not pushed yet ([ADR-0057](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)).

```sh
npm install -g @skillcdn/cli                 # or: npx @skillcdn/cli <command> ...
skillcdn check                               # the current directory, before pushing
skillcdn skills gh/acme/skills               # what a client is told on connect, then every skill and document
skillcdn browse gh/acme/skills marketing     # what a folder holds
skillcdn find gh/acme/skills release notes   # what the words find
skillcdn skill gh/acme/skills marketing/ads/SKILL.md   # one skill whole: rules, instructions, included files
skillcdn file gh/acme/skills docs/guide.md   # a page of a file
skillcdn skills ./packs/acme                 # the same from a directory: no server, no network
skillcdn use gh/acme/skills                  # bind this checkout to the pack, so that reads here name no pack (or: use ./packs/acme)
skillcdn status                              # what this checkout reads, and whether a token is kept for it
skillcdn login --url https://skillcdn.ai gh/acme/private   # connect to a private pack with a code a person approves
skillcdn mcp ./packs/acme                    # serve the directory to the MCP client that started the command
skillcdn serve ./packs/acme ./packs/other    # serve directories over HTTP: MCP at http://127.0.0.1:11189/local/packs/acme
```

## Reading a pack

A pack is named by its address at a deployment, `gh/<owner>/<repo>[@<ref>][/<path>]`, the URL of the pack at a deployment, or a `skill://` URI; or by a directory on this machine in the [SkillCDN Format](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md), a git checkout or any folder of skills, documents and rules. An address is read through [`@skillcdn/client`](https://www.npmjs.com/package/@skillcdn/client) at `--url`, else `SKILLCDN_URL`, else the deployment the directory is bound to, else `https://skillcdn.ai`, waiting while a first look at a commit indexes it. A directory is read as the indexer reads a commit and kept as an index in memory ([`@skillcdn/reader`](https://www.npmjs.com/package/@skillcdn/reader)). Either way the reads are a deployment's reads, and what is printed is what the matching tool of [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md) gives a model, with the reads named as the commands; `--json` prints the JSON of the matching route of [the REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) instead.

| Command | Over MCP | What it prints |
|---|---|---|
| `skills [<pack>]` | the connection, and `search_repo` without words | What a client is told on connect, then every skill with the path of its `SKILL.md` and every document outside the skills |
| `browse [<pack>] [<folder or file>]` | `browse_repo` | What a folder holds: skills, folders with what each holds, files; given a file, its outline, every heading with the offset and limit that read its section; a page, with `--cursor` to continue and `--limit` |
| `find [<pack>] <words...>` | `search_repo` | What the words find, skills first with their matching files, a document with the sections that matched and what reads each, `--path` to a folder; a page |
| `skill [<pack>] <path>` | `load_skill` | The skill whole: the rules from the root down, the instructions, the included files, then its files and references. The path of its `SKILL.md`, or its `skill://` URI, which names the pack as well |
| `file [<pack>] <path>` | `read_repo_file` | A page of the file as written (`--offset`, `--limit`), or what a folder holds; for a picture or an original, which the command does not carry, where its bytes are: at the host for a pack of a deployment, as a `file:` URL for a directory on this machine ([ADR-0077](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0077-the-bytes-of-a-file-that-is-not-text-are-sent-from-where-they-are.md)) |

Paths start at the pack's root, as `marketing/ads/SKILL.md`, and never leave it. Nothing in a directory is executed; a directory is addressed as `local/<its parent>/<its name>`, or as `--as local/<owner>/<name>` says, and is verified, since the person chose it, so its content is served in full under its license with no provenance notice ([addresses](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/address.md#served-from-a-machine)).

## A private pack, and a bound directory

A private repository is connected with a code a person approves ([ADR-0059](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0059-the-command-connects-with-a-code-a-person-approves.md)): `skillcdn login --url <origin> gh/<owner>/<repo>` prints the deployment's page for a code and the code; the person opens the page signed in, checks that it shows the same code, names the token and says how long it is good for, and approves; the command receives a repository token ([permissions](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/permissions.md#a-command-connects-with-a-code)) and keeps it, never showing it. An agent running the command relays the page and the code to its person and waits; the code is good for ten minutes. In a directory bound to the pack the address is left out. A token made by hand, on an account page or received by an app, is read from standard input with `--token-stdin` instead, asked for without echo at a terminal and piped in by a job; for one run, `SKILLCDN_URL` and `SKILLCDN_TOKEN` together do the same. Tokens are kept in the person's configuration directory (`~/.config/skillcdn/credentials.json`, or under `XDG_CONFIG_HOME`), readable by them alone where the system can say so, one per deployment and repository, and each is presented to the deployment it was kept for, at the repository it reads, and nowhere else. `skillcdn logins` names the deployments and repositories, never the tokens; `skillcdn logout --url <origin> [<address>]` forgets them.

`skillcdn use gh/acme/skills [--url <origin>]` binds the working directory to a pack at a deployment, and `skillcdn use ./packs/acme` to a directory on this machine, read with no deployment and no token: it writes `.skillcdn.json`, the address and where it is read, nothing secret, meant to be committed, so that a read there or in a directory below needs no pack argument and every agent working in the checkout reads the same pack. Nothing tells an agent to look until the checkout says so, which is why `use` prints the sentence for the checkout's agreement (`CLAUDE.md` or `AGENTS.md`), to be copied as it is:

> **Bound to a pack?** When .skillcdn.json is in this checkout, or `skillcdn status` names a pack, read its skills with `skillcdn skills` before you start, and load the one a task calls for (`skillcdn help` says how).

`skillcdn status` says what the directory reads and where, whether a token is kept for it, and the command's version, without reading anything: an agent that meets a checkout runs it first.

## Serving a directory

A directory is served as a deployment serves a pack, for a machine without a deployment, a network without one, or a pack not pushed yet ([ADR-0057](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)). `skillcdn mcp <directory>` serves it to the MCP client that started the command, over standard input and output: in the client's configuration, a stdio server whose command is `skillcdn` with the arguments `mcp` and the directory. `skillcdn serve <directory>... [--port <port>] [--host <host>]` serves directories over HTTP on this machine, an MCP server at `http://<host>:<port>/local/<owner>/<name>` for each and the REST API of the address under `/api/v1/`, on `127.0.0.1` at port `11189` unless told otherwise, until stopped; `GET /` on that port lists the packs served, each address with its directory, and says how to connect. Either way the client gets what [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md#served-from-a-machine) gives it from a deployment, the tools, the `use_skill` prompt and the skills extension, with the directory read again when its files change, a directory deleted and made anew in its place included, and nothing in it executed; a client is told to keep nothing it reads, since a working tree changes without a commit. A picture or an original of the directory, which the tools do not carry, is named by its `file:` URL over standard input and output, where the client is on this machine, and over HTTP by the server's own route, `GET /api/v1/raw/<address>?path=`, which sends the file as an attachment, whatever its size ([ADR-0077](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0077-the-bytes-of-a-file-that-is-not-text-are-sent-from-where-they-are.md)). Whoever reaches the port reads everything served, since nothing signs anyone in: keep it on this machine, or on a network of your own. The server is [`@skillcdn/serve`](https://www.npmjs.com/package/@skillcdn/serve), the package a deployment composes as well.

## Searching by meaning

A directory is searched by words alone unless `EMBEDDINGS_URL` and `EMBEDDINGS_MODEL` name an embeddings server, the variables a deployment takes, with the same defaults ([the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)); `RERANKER_URL` and `RERANKER_MODEL` add a reranking server. With them, `find`, `mcp` and `serve` embed the sections of the directory's documents as a deployment embeds them ([ADR-0064](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)) and rank by words and meaning, which the last line of a result says ([words and meaning](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md#words-and-meaning)); a served directory answers by words alone until its vectors arrive, `find` waits for them, and a read without words calls no server. The vectors are kept in the cache directory (`~/.cache/skillcdn/vectors`, or under `XDG_CACHE_HOME`) by the hash of each file, under the model's name and dimensions, so that a directory is embedded once on a machine, a run after an edit embeds the files that changed, and a change of model embeds everything again under a new name; a manifest's `search: { meaning: false }` keeps its documents to the words, as at a deployment. The text of the documents goes to the server named and nowhere else. The adapters are [`@skillcdn/inference`](https://www.npmjs.com/package/@skillcdn/inference), the ones a deployment uses; a server that does not answer leaves the words to answer, with a line on standard error, and the next read tries the rest again.

## Checking a pack

`skillcdn check [directory]` reads a directory the same way and prints what an agent would get: the version of the reading rules it applied, the repository manifest, the license, every skill with its files, its warnings, its license and whether the MCP skills extension lists it, the documents outside the skills, linked references, what is not served, the index diagnostics, and what a client is told on connect. An index diagnostic is something the indexer could not read as intended, with the same reason a deployment shows; a `SKILL.md` whose front-matter is not valid YAML is the usual one, and a local link that names no file, a picture without alternative text, a picture or an original that is not there, or a skill's reference to a file that is not text are the others ([the format](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md#required)). The license line says how a directory is served, in full, and what a deployment would do with the same pack as a repository. Add it to the repository (`npm install --save-dev @skillcdn/cli`) and run it from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

## Exit codes and limits

`0` done. `1`: for `check`, index diagnostics were found; for a read, the pack does not have what was asked for, or refuses it (no such skill, file or folder; a token the deployment does not take). `2` the pack cannot be read: the directory, or the deployment, which could not be reached or has not indexed the commit in time. `64` a usage error, `78` a variable that cannot be read, `70` a failure. A push or a job can be gated on them.

`.git`, `node_modules` and symbolic links are left out of a directory. A working directory is read rather than a commit, so untracked or ignored files can make what is printed differ from what is pushed. The limits a deployment applies can be set through the environment (`INDEX_MAX_FILES`, `INDEX_MAX_FILE_BYTES`, `READ_MAX_FILE_BYTES`, and the others listed in [the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)). The rules themselves are [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer).

Node.js 24 or newer.
