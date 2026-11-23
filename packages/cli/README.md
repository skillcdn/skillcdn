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

The `skillcdn` command, for two kinds of people. An author runs `skillcdn check` to see what an agent would get from a pack before pushing it, and `skillcdn catalog` to keep the list of skills in its README. An agent with a shell runs `skillcdn skills`, `browse`, `find`, `skill` and `file` to read a pack as an MCP client's model reads it, and `rows` and `code` to take its tables and code blocks as data, and `skillcdn search` to find the pack to read among every pack a deployment serves, without an MCP connection: the same text, from the same reading rules, from a pack at a deployment or from a directory on the machine ([ADR-0055](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0055-the-command-reads-a-pack-as-a-deployment-serves-it.md), [ADR-0056](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)). Either runs `skillcdn mcp` or `skillcdn serve` to serve a directory as a deployment would, to the MCP client that started the command or to any client on the machine, where there is no deployment or the pack is not pushed yet ([ADR-0057](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)).

```sh
npm install -g @skillcdn/cli                 # or: npx @skillcdn/cli@latest <command> ...
skillcdn check                               # the current directory, before pushing
skillcdn skills gh/acme/skills               # what a client is told on connect, then every skill and document
skillcdn browse gh/acme/skills marketing     # what a folder holds
skillcdn find gh/acme/skills release notes   # what the words find
skillcdn search release notes                # what the words find across every pack of the deployment, each under its address
skillcdn skill gh/acme/skills marketing/ads/SKILL.md   # one skill whole: rules, instructions, included files
skillcdn file gh/acme/skills docs/guide.md   # a page of a file
skillcdn rows ./packs/manual docs/annex-c --out codes.csv   # the tables under a folder, as one CSV
skillcdn code ./packs/manual docs/messages   # the fenced code blocks under a folder, as written
skillcdn skills ./packs/acme                 # the same from a directory: no server, no network
skillcdn use gh/acme/skills                  # bind this checkout to the pack, so that reads here name no pack (or: use ./packs/acme)
skillcdn status                              # what this checkout reads, and whether a token is kept for it
skillcdn login --url https://skillcdn.ai gh/acme/private   # connect to a private pack with a code a person approves
skillcdn embed ./packs/acme                  # embed its documents ahead of the first search (with EMBEDDINGS_URL and EMBEDDINGS_MODEL)
skillcdn mcp ./packs/acme                    # serve the directory to the MCP client that started the command
skillcdn serve ./packs/acme ./packs/other    # serve directories over HTTP: MCP at http://127.0.0.1:11189/local/packs/acme
```

## Reading a pack

A pack is named by its address at a deployment, `gh/<owner>/<repo>[@<ref>][/<path>]`, the URL of the pack at a deployment, or a `skill://` URI; or by a directory on this machine in the [SkillCDN Format](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md), a git checkout or any folder of skills, documents and rules. An address is read through [`@skillcdn/client`](https://www.npmjs.com/package/@skillcdn/client) at `--url`, else `SKILLCDN_URL`, else the deployment the directory is bound to, else `https://skillcdn.ai`, waiting while a first look at a commit indexes it. A directory is read as the indexer reads a commit and kept as an index in memory ([`@skillcdn/reader`](https://www.npmjs.com/package/@skillcdn/reader)). Either way the reads are a deployment's reads, and what is printed is what the matching tool of [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md) gives a model, with the reads named as the commands; `--json` prints the JSON of the matching route of [the REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) instead.

| Command | Over MCP | What it prints |
|---|---|---|
| `skills [<pack>]` | the connection; the listing has no tool of its own, and is what the REST search answers without words | What a client is told on connect, then every skill with the path of its `SKILL.md` and every document outside the skills; a listing longer than one read prints in pages, each ending with the command that lists the rest (`--cursor`) |
| `browse [<pack>] [<folder or file>]` | `browse_repo` | What a folder holds: skills, folders with what each holds, files; given a file, its outline, every heading with the offset and limit that read its section; a page, with `--cursor` to continue and `--limit` |
| `find [<pack>] <words...>` | `search_repo` | What the words find, a skill with its matching files, a document with the sections that matched and what reads each, `--path` to a folder; a page |
| `skill [<pack>] <path>` | `load_skill` | The skill whole: the rules from the root down, the instructions, the included files, then its files and references. The path of its `SKILL.md`, or its `skill://` URI, which names the pack as well. A skill longer than one read prints is printed in parts, so that the host running the agent shows each whole ([ADR-0108](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0108-the-command-prints-what-a-host-shows-whole-and-a-long-skill-in-parts.md)): a part that is not the last says how many pages of the skill follow it, at its head and at its end, and ends with the command that prints the next (`--cursor`), and the last says that the skill is complete ([ADR-0124](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0124-what-reaches-an-agent-is-bounded-in-bytes-on-either-route-and-a-part-says-what-a-page-says.md)); a part ends after a line, and a part after the first names the skill without saying its description, license, files and references again ([ADR-0113](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0113-a-page-of-a-skill-ends-after-a-line-and-a-later-part-does-not-say-the-skills-facts-again.md)); `--json` prints it whole |
| `file [<pack>] <path>` | `read_repo_file` | A page of the file as written (`--offset`, `--limit`; 24,000 characters ended at a line unless `--limit` says otherwise, and fewer where they do not print within one read, and the API's 40,000 with `--json`), or what a folder holds; for a picture or an original, which the command does not carry, where its bytes are: at the host for a pack of a deployment, as a `file:` URL for a directory on this machine ([ADR-0077](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0077-the-bytes-of-a-file-that-is-not-text-are-sent-from-where-they-are.md)) |

| `rows [<pack>] [<path>]` | none | The tables of a document, or of every document under a folder, as data ([ADR-0080](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0080-a-table-and-a-code-block-are-had-as-data-from-where-they-stand.md)): every row in reading order with the file and the section it stands in, as one CSV (`--format csv`, the default) or as an array of rows with their cells by column name (`--format json`); `--heading <words>` keeps the tables under a heading, `--out <file>` writes a file and says how much. A table that stands in several sections and files under the same header comes out as one |
| `code [<pack>] [<path>]` | none | The fenced code blocks of a document, or of every document under a folder, as written, each under a line that names its file, its section and what it says it is written in; `--heading <words>`, `--grep <pattern>`, a regular expression run on this machine, and `--out <file>` |

The two data commands are for what a model should not copy out by hand: a table of several hundred rows to build into a program, a set of definitions to generate from. The outline of a document (`skillcdn browse <pack> <file>`) says how many tables and code blocks it holds and names the command for them.

`skillcdn search <words...>` is for when no pack is known yet: what the words find across every public pack a deployment serves, as the `search_packs` tool at the deployment's root answers ([ADR-0070](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0070-a-deployment-is-searched-across-every-pack-it-serves.md)), a skill by its name and description or a document with the sections that matched, each under the address of its pack, at most 10 unless `--limit` says otherwise (up to 20). The reads take that address first, so an agent with a shell goes from a question to the skill in two commands: `skillcdn search release notes`, then `skillcdn skill gh/acme/skills marketing/release-notes/SKILL.md`. The deployment is `--url`, else `SKILLCDN_URL`, else the one the directory is bound to, else `https://skillcdn.ai`; the search covers public packs alone, so no token is sent; `--json` prints what `GET /api/v1/search` answers. It answers `1` at a deployment that has no such search, and `2` when the search did not answer in time.

Paths start at the pack's root, as `marketing/ads/SKILL.md`, and never leave it. Nothing in a directory is executed; a directory is addressed as `local/<its parent>/<its name>`, or as `--as local/<owner>/<name>` says, and is verified, since the person chose it, so its content is served in full under its license with no provenance notice ([addresses](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/address.md#served-from-a-machine)).

## A private pack, and a bound directory

A private repository is connected with a code a person approves ([ADR-0059](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0059-the-command-connects-with-a-code-a-person-approves.md)): `skillcdn login --url <origin> gh/<owner>/<repo>` prints the deployment's page for a code and the code; the person opens the page signed in, checks that it shows the same code, names the token and says how long it is good for, and approves; the command receives a repository token ([permissions](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/permissions.md#a-command-connects-with-a-code)) and keeps it, never showing it. An agent running the command relays the page and the code to its person and waits; the code is good for ten minutes. In a directory bound to the pack the address is left out. A token made by hand, on an account page or received by an app, is read from standard input with `--token-stdin` instead, asked for without echo at a terminal and piped in by a job; for one run, `SKILLCDN_URL` and `SKILLCDN_TOKEN` together do the same. Tokens are kept in the person's configuration directory (`~/.config/skillcdn/credentials.json`, or under `XDG_CONFIG_HOME`), readable by them alone where the system can say so, one per deployment and repository, and each is presented to the deployment it was kept for, at the repository it reads, and nowhere else. `skillcdn logins` names the deployments and repositories, never the tokens; `skillcdn logout --url <origin> [<address>]` forgets them.

`skillcdn use gh/acme/skills [--url <origin>]` binds the working directory to a pack at a deployment, and `skillcdn use ./packs/acme` to a directory on this machine, read with no deployment and no token: it writes `.skillcdn.json`, the address and where it is read, nothing secret, meant to be committed, so that a read there or in a directory below needs no pack argument and every agent working in the checkout reads the same pack. A public repository whose file names a deployment of its own or a private pack lists it in `.gitignore` instead, since that is the organization's to know, and each clone runs `skillcdn use` once; `use` says so when it writes the file. Nothing tells an agent to look until the checkout says so, which is why `use` prints the sentence for the checkout's agreement (`AGENTS.md`, or `CLAUDE.md` where that is the file agents read), to be copied as it is:

> **Bound to a pack?** Before the first step, run `skillcdn status`: when it names a pack, or `.skillcdn.json` is in this checkout, read that pack's skills and load the one the task calls for (its answer says how).

`skillcdn status` says what the directory reads and where, whether a token is kept for it, and the command's version, without reading anything: an agent that meets a checkout runs it first.

## Serving a directory

A directory is served as a deployment serves a pack, for a machine without a deployment, a network without one, or a pack not pushed yet ([ADR-0057](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)). `skillcdn mcp <directory>` serves it to the MCP client that started the command, over standard input and output: in the client's configuration, a stdio server whose command is `skillcdn` with the arguments `mcp` and the directory. `skillcdn serve <directory>... [--port <port>] [--host <host>]` serves directories over HTTP on this machine, an MCP server at `http://<host>:<port>/local/<owner>/<name>` for each and the REST API of the address under `/api/v1/`, on `127.0.0.1` at port `11189` unless told otherwise, until stopped; `GET /` on that port lists the packs served, each address with its directory, and says how to connect. Either way the client gets what [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md#served-from-a-machine) gives it from a deployment, the tools, the `use_skill` prompt and the skills extension, with the directory read again when its files change, a directory deleted and made anew in its place included, and nothing in it executed; a client is told to keep nothing it reads, since a working tree changes without a commit. A picture or an original of the directory, which the tools do not carry, is named by its `file:` URL over standard input and output, where the client is on this machine, and over HTTP by the server's own route, `GET /api/v1/raw/<address>?path=`, which sends the file as an attachment, whatever its size ([ADR-0077](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0077-the-bytes-of-a-file-that-is-not-text-are-sent-from-where-they-are.md)). Whoever reaches the port reads everything served, since nothing signs anyone in: keep it on this machine, or on a network of your own. The server is [`@skillcdn/serve`](https://www.npmjs.com/package/@skillcdn/serve), the package a deployment composes as well.

## Searching by meaning

A directory is searched by words alone unless `EMBEDDINGS_URL` and `EMBEDDINGS_MODEL` name an embeddings server, the variables a deployment takes, with the same defaults ([the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)); `RERANKER_URL` and `RERANKER_MODEL` add a reranking server. With them, `find`, `mcp` and `serve` embed the sections of the directory's documents, and the name and description of each skill as one text of its own, as a deployment embeds them ([ADR-0064](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md), [ADR-0065](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md)) and rank by words and meaning, which the last line of a result says ([words and meaning](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md#words-and-meaning)); a served directory answers by words alone until its vectors arrive, `find` waits for them, and a read without words calls no server. `skillcdn embed <directory>` embeds ahead of the first search: on a machine without a GPU a pack of thousands of sections takes hours, so the command says how many documents there are, every little while how many are done and about how long is left, and at the end what it embedded; a run that is stopped keeps what it made, and whatever reads the directory next finds the vectors there. While a served directory is still being embedded, the last line of a result says how far it is. The vectors are kept in the cache directory (`~/.cache/skillcdn/vectors`, or under `XDG_CACHE_HOME`) by the hash of each file, under the model's name and dimensions, so that a directory is embedded once on a machine, a run after an edit embeds the files that changed, and a change of model embeds everything again under a new name; a manifest's `search: { meaning: false }` keeps its documents to the words, as at a deployment. The text of the documents goes to the server named and nowhere else. The adapters are [`@skillcdn/inference`](https://www.npmjs.com/package/@skillcdn/inference), the ones a deployment uses; a server that does not answer leaves the words to answer, with a line on standard error, and the next read tries the rest again.

## Checking a pack

`skillcdn check [directory]` reads a directory the same way and prints what an agent would get: its own version and the version of the reading rules it applied, the repository manifest, the license, every skill with its files, its warnings, its license, whether the MCP skills extension lists it and whether the document it serves there, in one piece, is over the 24 KiB a tool result is kept within, and how large its context is and in how many pages an agent reads it (with what its included files weigh where it is over the 16 KiB a skill aims at, and where a page ends inside a table, a code block or a line), the documents outside the skills, linked references, what is not served, the index diagnostics, and what a client is told on connect. An index diagnostic is something the indexer could not read as intended, with the same reason a deployment shows; a `SKILL.md` whose front-matter is not valid YAML is the usual one, and a local link that names no file, a link whose fragment names no section of its file, a quotation of a document made from the pack's documents that is not in the section it names, a picture without alternative text, a picture or an original that is not there, or a skill's reference to a file that is not text are the others ([the format](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md#required)). A note is something an author may want to know that fails nothing: a section longer than one read carries (`section_large`), skills over the size a skill aims at (`skill_large`), skills the extension serves as a document of more than a tool result holds (`served_large`), pages of a skill that end inside a code block or a line (`page_cut`). The license line says how a directory is served, in full, and what a deployment would do with the same pack as a repository. Add it to the repository (`npm install --save-dev @skillcdn/cli`) and run it from a script or a CI job:

```yaml
- run: npx @skillcdn/cli@latest check
```

A link whose destination is a skill URI, `skill://gh/<owner>/<repo>/<path>`, names a file of another pack ([ADR-0120](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0120-a-link-to-a-skill-uri-names-a-file-of-another-pack.md)). `check` lists such links, and `check --references` reads each once at `--url`, else `SKILLCDN_URL`, else `https://skillcdn.ai`, as `skillcdn file` would: a file that pack does not have fails the check with `1`, and a pack that could not be asked is `not known` and fails nothing.

`@latest` is part of the command: a runner goes on using the version it fetched first, and a command reads by the rules it was built with. When the npm registry has a later release, `check` says so in a line on standard error, beside the report; the request is the only one `check` makes, never changes its exit code, and is left out with `--offline` or `SKILLCDN_OFFLINE=1`.

## The table of skills in a README

The people who open a pack at its git host read a README, and the list of skills there is a copy kept by hand. `skillcdn catalog [directory]` makes it from the pack ([ADR-0121](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0121-the-command-writes-the-table-of-a-packs-skills-into-its-readme.md)): a Markdown table of the skills a search would list, in path order, each name linked to its `SKILL.md` with the first sentence of its description, then how many there are. Printed, for the whole pack or for `--folder <path>`; or written into a file with `--write <file>`, between two comments the file holds:

```markdown
<!-- skillcdn:catalog -->
<!-- /skillcdn:catalog -->
```

The region lists the skills under the folder the file stands in, or under the folder its opening comment names from the root of the pack, `<!-- skillcdn:catalog folder=marketing -->`, with links written from the file; a file may hold several, and nothing outside them is touched. `--check <file>` writes nothing and exits with `1` when a region is not what `--write` would make it:

```yaml
- run: npx @skillcdn/cli@latest catalog --check README.md
```

## Exit codes and limits

`0` done. `1`: for `check`, index diagnostics were found; for a read, the pack does not have what was asked for, or refuses it (no such skill, file or folder; a token the deployment does not take). `2` the pack cannot be read: the directory, or the deployment, which could not be reached or has not indexed the commit in time. `64` a usage error, `78` a variable that cannot be read, `70` a failure. A push or a job can be gated on them.

`.git`, `node_modules` and symbolic links are left out of a directory. A working directory is read rather than a commit, so untracked or ignored files can make what is printed differ from what is pushed. The limits a deployment applies can be set through the environment (`INDEX_MAX_FILES`, `INDEX_MAX_FILE_BYTES`, `READ_MAX_FILE_BYTES`, and the others listed in [the deployment contract](https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md#environment-contract)). The rules themselves are [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer).

Node.js 24 or newer.

## The reads as a library

A program with commands of its own that reads packs at a deployment prints them as `skillcdn` does, in its own words, with the reads this package exports ([ADR-0110](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0110-the-reads-of-the-command-are-a-library-for-other-commands.md)). The entry point imports nothing of the file system and nothing that indexes or serves: the pack is read through [`@skillcdn/client`](https://www.npmjs.com/package/@skillcdn/client).

What such a program brings is its pack, the names of its commands (`words`) and the command line that reads on from a cursor (`nextPart`); what a read says, how long it may be and where it ends are this package's. It prints the text as it is and adds nothing to it: a read is made to fit what a host shows of one output with the text it says, and a sentence added after it may pass that bound, or say again or otherwise what the read already says ([ADR-0124](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0124-what-reaches-an-agent-is-bounded-in-bytes-on-either-route-and-a-part-says-what-a-page-says.md)). Where it acts on a read, as a program, it reads `next`, never the text.

```ts
import { openDeployment, readPack, PackError, ReadMisuse, wroteLine } from "@skillcdn/cli";
import { parseAddress } from "@skillcdn/core";

const address = parseAddress("/gh/acme/skills");
if (!address.ok) throw new Error("not an address");
const pack = openDeployment({
  url: "https://skillcdn.ai",
  address: address.value,
  token: undefined,
  fetch,
  userAgent: "my-command",
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const words = { browse: "my skills", search: "my skills --search", load: "my skill", read: "my skill --file" };
const part = await readPack(pack, { read: "skill", path: "marketing/ads/SKILL.md" }, {
  words,
  nextPart: (cursor) => `my skill marketing/ads/SKILL.md --cursor ${cursor}`,
});
console.log(part.text);
```

The entry points, and what each is for. The table names what you start from, not every export: the constants, helpers and types beside them are in the declarations the package ships, with the doc comments they carry, which an editor shows.

| Export | What it is |
|---|---|
| `readPack(pack, read, options)` | One read, as the command prints it, within `COMMAND_OUTPUT_MAX_BYTES` of `@skillcdn/core`: `skills` (in pages where `nextPart` says how to read on, else whole), `browse`, `find`, `skill` (in parts, each saying how many pages follow it and ending with the line `nextPart` makes, the last saying that the skill is complete), `file` (`FILE_PAGE_CHARS` ended at a line unless a limit is given, and fewer where they do not fit), `rows` and `code`. It answers `{ text }`, `next` where the read goes on (the `cursor` of the next part or page, with `pagesLeft` for a skill, or the `offset` of a file), and for the data reads `holds` as well, what the text holds, for `wroteLine` when you write it to a file. `room` keeps as many bytes of the bound free for what you print beside the text. Print the text as it is: it says in your words what to read next, and when a skill is complete ([ADR-0124](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0124-what-reaches-an-agent-is-bounded-in-bytes-on-either-route-and-a-part-says-what-a-page-says.md)). `json` gives the REST API's JSON instead. `words` names the reads in the text, `COMMAND_WORDS` by default, and may name what the next read of a long skill is called (`piece`, "part" by default). The mount is asked for once by a read that prints the pack and its commit, and not at all by `rows`, `code` and the reads with `json`; a pack that pages a skill or its listing without end is given up on as `invalid_response`. |
| `openDeployment(options)` | A `Pack` at a deployment: its REST API through the client, with a token as the bearer. A read asks for what it reads and nothing first; where the deployment answers that the commit is being indexed, it waits up to `waitMs` for the index and asks again. |
| `shellWord(word)` | A word of a command line an agent is given to run, quoted where a shell would split or expand it: for a `nextPart` of your own. |
| `PackError`, `ReadMisuse` | What the pack does not have or refuses, with the API's status and code (`skill.not_found` lists the skills there are, in your words); and what was not asked right, a number out of its range or a pattern that does not parse, worded for a flag (`--limit takes an integer between 1 and 200`). Printing them, and the exit code, are yours. |
| `readNumber(value, name, max)` | A flag's number as the command checks it, with the same words. |

## Rules

For whoever changes this package: read the root [`AGENTS.md`](https://github.com/skillcdn/skillcdn/blob/main/AGENTS.md) first. This package is what an author and an agent install; it is thin on purpose.

- **Arguments, environment, output and exit codes, nothing else.** The reading rules are `@skillcdn/indexer`'s, the reads `@skillcdn/reader`'s, the words `@skillcdn/core`'s, a deployment `@skillcdn/client`'s and the edges `@skillcdn/serve`'s; a command here parses what it was given, hands it over and prints. Logic that is not about the command line moves down.
- **`src/bin.ts` is the only reader of `process`.** Everything else takes an `environment` record and output functions, so that `runCli` runs in a test without a process; every behavior has a test through it.
- **Exit codes are a contract** (ADR-0055). `check` answers `0`, `1` or `2` as the server's role does; a read answers `1` for what the pack does not have or refuses and `2` for a pack that cannot be read at all; `64` is a usage error, `78` configuration that cannot be read, `70` an internal failure. Changing one is a breaking change.
- **Output is for people and scripts alike.** The report goes to stdout, everything else to stderr; a problem names the variable and the rule, never the value.
- **No dependencies beyond the workspace.** Argument parsing is `node:util`; a library here needs a stronger case than anywhere but `core`.
