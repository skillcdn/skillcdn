<div align="center">
  <a href="https://skillcdn.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/logo-white.svg">
      <img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/logo-black.svg" width="360">
    </picture>
  </a>
  <p><strong>Turn any git repository into an MCP server.</strong></p>
  <p>
    <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
    <a href="https://github.com/skillcdn/skillcdn/actions/workflows/release.yml"><img alt="Release" src="https://github.com/skillcdn/skillcdn/actions/workflows/release.yml/badge.svg?branch=main"></a>
    <a href="https://www.npmjs.com/package/@skillcdn/cli"><img alt="@skillcdn/cli on npm" src="https://img.shields.io/npm/v/@skillcdn/cli?label=%40skillcdn%2Fcli"></a>
    <a href="LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
  </p>
  <p>
    <a href="https://skillcdn.ai">skillcdn.ai</a> · <a href="https://skillcdn.ai/docs">Documentation</a> · <a href="docs/specs/">Specifications</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

> **Status: pre-alpha.** The service is live at [skillcdn.ai](https://skillcdn.ai), and what this page describes is built unless it says otherwise. The format, the tools, the REST API and the packages still change between `0.x` releases. [docs/roadmap.md](docs/roadmap.md) says what exists and what is next.

Your team's skills, playbooks and documents already live in git. SkillCDN puts them in front of every AI agent with one address: connect an agent to `skillcdn.ai/gh/<owner>/<repo>` and it has the whole repository as tools. Nothing to upload, nothing to package, no publish step. Push, and the agents have it.

```
skillcdn.ai/gh/<owner>/<repo>                    default branch, latest
skillcdn.ai/gh/<owner>/<repo>@v1.2.0             pinned tag or commit
skillcdn.ai/gh/<owner>/<repo>@main/skills/ads    sub-path inside the repo
```

**Try it now.** Add `https://skillcdn.ai/gh/skillcdn/skills` as a remote MCP server in ChatGPT, Claude, Cursor, VS Code, Claude Code, Codex CLI, Gemini CLI or any other MCP client, and ask for a deck, a card news post or a web app. [The page of the address](https://skillcdn.ai/gh/skillcdn/skills) has the steps for each client.

---

## Why SkillCDN

- **An address is the whole setup.** No installer, no plugin, and for a public repository no account. Any client that adds a remote MCP server connects; an agent that has only a shell reads the same pack with the `skillcdn` command.
- **Git stays the source of truth.** We read, index and serve. We never host your content. Review happens where it always did, and a pinned tag or commit serves exactly what was reviewed.
- **Private stays private, on the permissions you already have.** A GitHub App on the repositories you choose, sign-in over standard MCP OAuth, and GitHub deciding who sees what on every request. No user table, no team table, nothing to keep in sync.
- **Search that lands on the section.** An agent browses by folder and by a file's outline, searches by words and by meaning, and reads the section that answers instead of the whole file. A handbook or a body of specifications is a pack too, with no skill in it.
- **One image, anywhere.** The same container and one PostgreSQL run the hosted service, a server of your own, and a network with no internet at all: packs from a directory, models beside the image, the whole installation carried in as one bundle.
- **Declared, never executed.** A repository is Markdown and declarations. SkillCDN runs no third-party code, on the server or on anyone's machine.

## From one skill to a whole team

SkillCDN is the base of three repositories built toward one thing: a team of AI agents working beside its people, each agent with the skills of its job, all of them on one board.

| | What it is | Start at |
|---|---|---|
| **SkillCDN**<br>this repository | The standard and the server: the format a pack is written in, the address that serves it, the command that reads it. | `skillcdn.ai/gh/<owner>/<repo>` |
| [**SkillCDN Pack**](https://github.com/skillcdn/skills)<br>`skillcdn/skills` | Skills for real company work, by area: marketing, design, engineering, product, media, operations, writing. A short ad from a product link, a card news post, a deck, a web app live with payments, the minutes of a meeting. Each is written from work done once with the real tool and run again by a fresh agent before it ships. MIT, and meant to be forked into a pack of your own. | [`skillcdn.ai/gh/skillcdn/skills`](https://skillcdn.ai/gh/skillcdn/skills) |
| [**SkillCDN Console**](https://github.com/skillcdn/console)<br>`skillcdn/console` | The board where people decide and agents work: the tasks, the runs on them, what was handed in, and the decisions that wait for a person. An agent works as the person whose command it runs, or as an **agent account**: a member of its own with a manager above it, a machine and a desk of its own, assigned work and asked as a colleague is. MIT, one image beside PostgreSQL. | [`skillcdn.ai/gh/skillcdn/console`](https://skillcdn.ai/gh/skillcdn/console) |

Put together: an organization keeps its skills in git, SkillCDN hands them to every agent, the pack is what a team starts with, and the console is where that team, people and agent accounts alike, takes its work, reports and gets its decisions. Both are the reference of their kind and meant for real use. They follow the standard like any other consumer, define nothing of it, and nothing here depends on them ([ADR-0047](docs/adr/0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)).

## Quick start

**Use a pack.** Paste an address into your AI app where it asks for a remote MCP server or a custom connector. That is all of it: [using skills from your AI](docs/guide/use-skills.md).

**Publish your own.** A public GitHub repository of `SKILL.md` folders or of documents already has an address. See what an agent will get before you push:

```sh
npx @skillcdn/cli@latest check
```

The guides say the rest: [a pack](docs/guide/write-a-repository.md), [its skills](docs/guide/write-skills.md), [its documents](docs/guide/write-documents.md).

**Read from a shell, without MCP.** The command prints what an MCP client's model is given, from a deployment or from a folder on the machine:

```sh
npx @skillcdn/cli@latest search release notes          # across every pack the deployment serves
npx @skillcdn/cli@latest skills gh/skillcdn/skills     # what an agent is told on connect, then every skill and document
npx @skillcdn/cli@latest serve ./my-pack               # a folder as an MCP server on this machine: no deployment, no network
```

**Run your own.** On a host with Docker, from `deploy/` of a checkout at a release:

```sh
./install.sh --url https://skills.example.com
```

One image, one PostgreSQL, secrets of the script's own making. [deploy/README.md](deploy/README.md) is the contract, with the bundle for a host without internet.

## How it works

### Public repo

1. An agent connects to `skillcdn.ai/gh/owner/repo`.
2. The first request indexes the repository: skills, manifests, documents and the files they link. The index is kept per repository and commit and shared by everyone.
3. The agent sees a small, fixed set of tools rather than one tool per skill.
4. A branch or a tag is looked up again after a short while, and at once where the GitHub App is installed; only what changed is fetched. A worker reads the packs a deployment keeps fresh before anyone asks, and while a new commit is being read the address answers from the last one.

### Private repo

1. An org admin installs the SkillCDN GitHub App and **selects which repos** it may read. Permissions are contents and metadata, read-only.
2. A user adds the address to their agent. The agent is told where to ask for access and starts MCP OAuth; we hand off to GitHub login and receive a user token. The GitHub token stays server-side; the agent only ever holds a SkillCDN token, good for that one address. Signing in on the site opens the same repositories in the browser.
3. On every request we ask GitHub whether this user can see this repo and cache the yes/no for a short time. Teams, outside collaborators, internal repos, SSO enforcement: GitHub decides, we relay. A repository someone may not see answers exactly like one that does not exist.
4. Indexing uses the App installation token, never a user token. GitHub's webhooks end a cached answer at once: a repository made private, the App removed, a person who revoked it, and, where the App may read an organization's members, a change of collaborators, teams or members.

Authorization is optional: a public repository never asks for it. An agent that has nobody to sign in, such as a scheduled job or a server, is given a **repository token**: made on their account pages by anyone who can read the repository, good for that one repository, read-only and revocable, with an end or without one. It reads as the person who made it, so GitHub still decides what it opens: there is no permission layer of our own. Both tokens are taken over MCP and by the REST API, so a program built on the API, a console or a job, reads a private repository as an agent does. The `skillcdn` command gets its token with a code a person approves in the browser, and never shows it.

Every account has a page at `skillcdn.ai/gh/<owner>` with its public repositories as GitHub lists them, the ones already indexed with skills first.

### Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `browse_repo` | page through the repository's real folders, with descriptions and counts; given a file, its outline |
| `search_repo` | search skills and documents within the mount or a chosen folder, by words and, where the deployment turns it on, by meaning; a result names the sections that matched |
| `load_skill` | load an exact `SKILL.md` path, its inherited rules and required files through bounded pages |
| `read_repo_file` | read a text file by its repository-root path, whole or one section |
| `search_packs` | at the root of a deployment: search every public pack it serves, to find the one to connect to |
| `describe` / `run` | *(undecided)* composed tools declared in Markdown or YAML |

One `use_skill(path)` prompt starts loading a skill. The server introduces the pack and its folders when an agent connects; browsing and search provide the rest. Names are display metadata, and every content path keeps its actual spelling from the repository root.

An agent whose host implements the [MCP skills extension](docs/specs/tools.md#the-skills-extension) receives the same skills as skills: listed with a digest for every file, and each `SKILL.md` served as a plain Agent Skills document with its inherited rules and required files inside it, under `skill://gh/<owner>/<repo>/<path>`.

Connect the pack's root by default, so one connection reaches skills for different tasks and their shared Markdown references. Sub-path connections remain available when a narrower scope is wanted. Optional `SKILLCDN.md` files describe folders, add common rules and explicitly exclude files or subtrees; nested rules arrive with each skill in order. Repositories without those manifests still work through their real folder structure and optional README introductions. Discovery stays brief; agents load instructions and references only when needed.

The repo declares things; it never ships code that we execute. This is a deliberate security boundary: SkillCDN runs no third-party code, on the server or on the user's machine.

### What we do with content

SkillCDN reads, indexes and serves what a repository publishes, keeps copies only to serve them, and takes them down on request. The license a skill carries decides whether its content is passed on or only described with a link to its source: permissive licenses are served with their notice, restrictive ones are described unless the repository is verified, and a repository without a license is served with its provenance and never featured ([licenses](docs/specs/skill-repo.md#licenses)). A private repository is served in full to the people who may open it, whatever its license says. Where to send a takedown request is part of each deployment's own pages.

Specifications: [address scheme](docs/specs/address.md) · [the SkillCDN Format: what a pack is](docs/specs/skill-repo.md) · [tools](docs/specs/tools.md) · [REST API](docs/specs/rest.md) · [people and private repositories](docs/specs/permissions.md).

## Architecture

```
[agent]       any MCP client, or the skillcdn command from a shell
     |   skillcdn.ai/gh/<owner>/<repo>[@ref][/path]   anonymous for public read; OAuth or a repository token for private
[api]         stateless: MCP over HTTP · REST · sign-in and OAuth · permission check · the pages · the git host's events · indexes a commit on first request
[worker]      indexes packs ahead of requests · embeds their sections for the search by meaning · removes the indexes nothing keeps
[postgres]    the index (full-text, and vectors on pgvector) · file bodies by content hash · permission cache · people and tokens · the job queue
[git host]    GitHub, GitHub Enterprise Server; or a directory of the deployment's own, with no git host
[inference]   optional: an embeddings server and a reranker of open-weight models, beside the image
```

One image with several roles, one database, caches keyed per repo and never per user, an optional web UI, and git hosts behind one adapter interface. Other git hosts and a blob store on S3-compatible storage are planned behind the ports that are there ([docs/roadmap.md](docs/roadmap.md)). The full picture is in [docs/architecture.md](docs/architecture.md); the decisions behind it are in [docs/adr/](docs/adr/).

## Repository layout

TypeScript monorepo: pnpm workspaces, Turborepo, Node.js 24, PostgreSQL 18.

```
apps/
  server/     the single deployable; roles: api | worker | migrate | check | purge     Hono + MCP SDK
  web/        optional web UI: landing page, explorer, documentation                  Vite + React
packages/
  core/       address parser, the SkillCDN Format, permission rules, tool and REST contracts, search word rules, ports   pure TS
  db/         schema, migrations, query layer                           Drizzle + PostgreSQL
  github/     GitHub App, user-token and contents adapter               implements the git-host port
  indexer/    the reading rules: a commit or a working tree read into an index   Node.js, no database
  inference/  the adapters of the common embeddings and reranking APIs, for the search by meaning
  reader/     the reads of a mount over an index, wherever the index is kept
  client/     the REST API as typed functions, for Node.js and the browser
  serve/      the MCP surface and the REST address routes as a library over a reader
  cli/        the skillcdn command: check a pack, read one as an agent gets it, serve a directory   bin
  brand/      the pictures of the brand as files, under the trademark policy    no code
apps/server/fixtures/.repositories/  test-only repository fixtures
deploy/       Dockerfile, the compose bundle and its scripts, the contract for whoever operates the image
docs/         architecture, specs, guides, ADRs, roadmap
```

## Packages

On npm, under the `@skillcdn` scope, released together at one version, each with its own changelog ([ADR-0046](docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md), [ADR-0058](docs/adr/0058-the-published-packages-share-one-version.md)). Install them at one version and move them together: a patch changes nothing that exists, a minor may, and says so first in its changelog.

| Package | Version | What it is |
|---|---|---|
| [`@skillcdn/cli`](https://www.npmjs.com/package/@skillcdn/cli) | [![npm](https://img.shields.io/npm/v/@skillcdn/cli)](https://www.npmjs.com/package/@skillcdn/cli) | the `skillcdn` command: check a pack before pushing (`npx @skillcdn/cli@latest check`), read one as an agent gets it over MCP, serve a directory over stdio or HTTP |
| [`@skillcdn/serve`](https://www.npmjs.com/package/@skillcdn/serve) | [![npm](https://img.shields.io/npm/v/@skillcdn/serve)](https://www.npmjs.com/package/@skillcdn/serve) | the MCP tools, the prompt and the skills extension, and the REST routes of an address, as a library over a reader |
| [`@skillcdn/client`](https://www.npmjs.com/package/@skillcdn/client) | [![npm](https://img.shields.io/npm/v/@skillcdn/client)](https://www.npmjs.com/package/@skillcdn/client) | the REST API as typed functions, for Node.js and the browser |
| [`@skillcdn/reader`](https://www.npmjs.com/package/@skillcdn/reader) | [![npm](https://img.shields.io/npm/v/@skillcdn/reader)](https://www.npmjs.com/package/@skillcdn/reader) | the reads of a mount over an index, wherever the index is kept |
| [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer) | [![npm](https://img.shields.io/npm/v/@skillcdn/indexer)](https://www.npmjs.com/package/@skillcdn/indexer) | the reading rules: a commit or a working tree read into an index |
| [`@skillcdn/inference`](https://www.npmjs.com/package/@skillcdn/inference) | [![npm](https://img.shields.io/npm/v/@skillcdn/inference)](https://www.npmjs.com/package/@skillcdn/inference) | the adapters of the common embeddings and reranking APIs, for the search by meaning |
| [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core) | [![npm](https://img.shields.io/npm/v/@skillcdn/core)](https://www.npmjs.com/package/@skillcdn/core) | the contracts: addresses, the convention, tool and REST schemas, the renderers, the ports |
| [`@skillcdn/web`](https://www.npmjs.com/package/@skillcdn/web) | [![npm](https://img.shields.io/npm/v/@skillcdn/web)](https://www.npmjs.com/package/@skillcdn/web) | the web UI of a deployment, with the command that builds it with pages of your own (`skillcdn-web build`) |
| [`@skillcdn/brand`](https://www.npmjs.com/package/@skillcdn/brand) | [![npm](https://img.shields.io/npm/v/@skillcdn/brand)](https://www.npmjs.com/package/@skillcdn/brand) | the pictures of the brand as files, for the places the [trademark policy](TRADEMARKS.md) allows; not open source ([ADR-0048](docs/adr/0048-the-brand-files-are-a-package-of-their-own-under-the-trademark-policy.md)) |

Hosted and self-hosted run the same image against any PostgreSQL 18, with file bodies in the database. The image of each release is published, and a compose bundle with an install script runs it on one host, from that image or from a bundle carried to a host without internet ([deploy](deploy/README.md#running-with-compose)).

## Development

```sh
pnpm install          # needs pnpm 12.4+; the Node.js runtime is pinned and fetched by pnpm
pnpm check            # lint, build, typecheck, test
```

Setup details and the contribution process are in [CONTRIBUTING.md](CONTRIBUTING.md). The rules of the codebase, for people and AI agents alike, are in [AGENTS.md](AGENTS.md). Secrets are never committed; `.env.example` holds example values only.

## License

SkillCDN is **source-available** under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md) (`FSL-1.1-ALv2`).

- Use it, modify it, self-host it and build on it, commercially or not.
- The one thing reserved is offering this software, or something substantially similar built from it, to others as a competing commercial product or service.
- Every release becomes Apache 2.0 two years after it is published.

This summary is not the license; [LICENSE.md](LICENSE.md) is. The specifications in [docs/specs/](docs/specs/) are licensed under the [Apache License 2.0](docs/specs/LICENSE), so that anyone may implement the format and the tools. "SkillCDN" and its logos are trademarks of KDX Labs Corp. and are not licensed with the code; see [TRADEMARKS.md](TRADEMARKS.md), which also allows everyone the format's file name and front-matter key. The hosted service at `skillcdn.ai` is operated by KDX Labs. Fonts bundled with the web UI have licenses of their own; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

Built by KDX Labs. Copyright (c) 2026 KDX Labs Corp.
