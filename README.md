<div align="center">
  <a href="https://skillcdn.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/logo-white.svg">
      <img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/logo-black.svg" width="360">
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
    <a href="https://skillcdn.ai">skillcdn.ai</a> · <a href="docs/specs/">Specifications</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

> **Status: pre-alpha.** This README describes what we are building. [docs/roadmap.md](docs/roadmap.md) says what exists today. Nothing here is a commitment to a public API yet.

Point an agent at `skillcdn.ai/gh/<owner>/<repo>` and it gets the skills, playbooks and documents in that repo as tools. No hosting, no packaging, no publish step: the repo *is* the skill.

```
skillcdn.ai/gh/<owner>/<repo>                    default branch, latest
skillcdn.ai/gh/<owner>/<repo>@v1.2.0             pinned tag or commit
skillcdn.ai/gh/<owner>/<repo>@main/skills/ads    sub-path inside the repo
```

---

## Why

Agent skills are already distributed as folders of Markdown in git repos. The missing piece is the last mile: getting that folder into an agent that only speaks MCP, keeping it up to date, and doing it for private repos with the permissions you already have on your git host.

- **Address, not install.** A URL is the whole onboarding. It works with any client that can add a remote MCP server.
- **Git is the source of truth.** We never host content. We read, index and serve. Pin a ref and the skill you reviewed yesterday is the skill you run today.
- **Your git-host permissions are our permissions.** Public repo: no auth, no signup. Private repo: a GitHub App installed on the org plus standard MCP OAuth. There is no separate user or team table for you to manage.
- **Same image everywhere.** One container image, one PostgreSQL. It runs on our cloud, on your own box, or inside an air-gapped network against GitLab or Gitea.

## How it works

### Public repo

1. An agent connects to `skillcdn.ai/gh/owner/repo`.
2. The first request triggers a lazy index of the repo (Markdown, small JSON, skill manifests). The index is cached per repo and commit and shared by everyone.
3. The agent sees a small, fixed set of meta tools rather than one tool per skill.
4. A branch or a tag is looked up again after a short while. With the GitHub App installed, a push is served by the very next request, and only what changed is fetched.

### Private repo

1. An org admin installs the SkillCDN GitHub App and **selects which repos** it may read. Permissions are contents and metadata, read-only.
2. A user adds the address to their agent. The agent is told where to ask for access and starts MCP OAuth; we hand off to GitHub login and receive a user token. The GitHub token stays server-side; the agent only ever holds a SkillCDN token, good for that one address. Signing in on the site opens the same repositories in the browser.
3. On every request we ask GitHub whether this user can see this repo and cache the yes/no for a short time. Teams, outside collaborators, internal repos, SSO enforcement: GitHub decides, we relay. A repository someone may not see answers exactly like one that does not exist.
4. Indexing uses the App installation token, never a user token. GitHub's webhooks end a cached answer at once: a repository made private, the App removed, a person who revoked it, and, where the App may read an organization's members, a change of collaborators, teams or members.

Authorization is optional: a public repository never asks for it. An agent that has nobody to sign in, such as a scheduled job or a server, is given a **repository token**: made on their account pages by anyone who can read the repository, good for that one repository, read-only, expiring and revocable. It reads as the person who made it, so GitHub still decides what it opens: there is no permission layer of our own.

Every account has a page at `skillcdn.ai/gh/<owner>` with its public repositories as GitHub lists them, the ones already indexed with skills first.

### Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `browse_repo` | page through the repository's real folders, with descriptions and counts |
| `search_repo` | search skills and documents within the mount or a chosen folder |
| `load_skill` | load an exact `SKILL.md` path, its inherited rules and required files through bounded pages |
| `read_repo_file` | read a raw text file by its repository-root path |
| `intake` | *(later)* walk a non-expert through the questions a skill declares |
| `describe` / `run` | *(later)* composed tools declared in Markdown or YAML |

One `use_skill(path)` prompt starts loading a skill. The server introduces the repository and its folders when an agent connects; browsing and search provide the rest. Names are display metadata, and every content path keeps its actual spelling from the repository root.

An agent whose host implements the [MCP skills extension](docs/specs/tools.md#the-skills-extension) receives the same skills as skills: listed with a digest for every file, and each `SKILL.md` served as a plain Agent Skills document with its inherited rules and required files inside it, under `skill://gh/<owner>/<repo>/<path>`.

Connect the repository root by default, so one connection reaches skills for different tasks and their shared Markdown references. Sub-path connections remain available when a narrower scope is wanted. Optional `SKILLCDN.md` files describe folders, add common rules and explicitly exclude files or subtrees; nested rules arrive with each skill in order. Repositories without those manifests still work through their real folder structure and optional README introductions. Discovery stays brief; agents load instructions and references only when needed.

The repo declares things; it never ships code that we execute. This is a deliberate security boundary: SkillCDN runs no third-party code, on the server or on the user's machine.

### What we do with content

SkillCDN reads, indexes and serves what a repository publishes, keeps copies only to serve them, and takes them down on request. The license a skill carries decides whether its content is passed on or only described with a link to its source: permissive licenses are served with their notice, restrictive ones are described unless the repository is verified, and a repository without a license is served with its provenance and never featured ([licenses](docs/specs/skill-repo.md#licenses)). Where to send a takedown request is part of each deployment's own pages.

Specifications: [address scheme](docs/specs/address.md) · [skill-repo convention](docs/specs/skill-repo.md) · [tools](docs/specs/tools.md) · [people and private repositories](docs/specs/permissions.md).

## Architecture

```
[agent]      any MCP client
     |   skillcdn.ai/gh/<owner>/<repo>[@ref][/path]   OAuth, or anonymous for public read
[api]        stateless MCP over HTTP · sign-in and OAuth · permission check · meta tools · REST for the web app · webhook receiver
[worker]     index and re-index on webhook or schedule   (same image as api, different role)
[check]      read a working tree with the same indexer, for authors before they push: the image's role, or the skillcdn command   (no database)
[postgres]   content index (full-text) · permission cache · job queue · later: vectors
[git host]   GitHub (App) · GitLab / Gitea (self-hosted, air-gapped)
```

One image with several roles, one database, caches keyed per repo and never per user, an optional web UI, and git hosts behind one adapter interface. The full picture is in [docs/architecture.md](docs/architecture.md); the decisions behind it are in [docs/adr/](docs/adr/).

## Repository layout

TypeScript monorepo: pnpm workspaces, Turborepo, Node.js 24, PostgreSQL 18.

```
apps/
  server/     the single deployable; roles: api | worker | migrate | check     Hono + MCP SDK
  web/        optional web UI: landing page and explorer              Vite + React
packages/
  core/       address parser, skill-repo convention, permission rules, tool contracts, ports   pure TS
  db/         schema, migrations, query layer                           Drizzle + PostgreSQL
  github/     GitHub App, user-token and contents adapter               implements the git-host port
  indexer/    the reading rules: a commit or a working tree read into an index   Node.js, no database
  cli/        the skillcdn command for repository authors: skillcdn check        bin
apps/server/fixtures/.repositories/  test-only repository fixtures
deploy/       Dockerfile, compose files, the contract for whoever operates the image
docs/         architecture, specs, ADRs, roadmap
```

On npm, under the `@skillcdn` scope, each with its own version and changelog ([ADR-0046](docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)):

| Package | Version | What it is |
|---|---|---|
| [`@skillcdn/cli`](https://www.npmjs.com/package/@skillcdn/cli) | [![npm](https://img.shields.io/npm/v/@skillcdn/cli)](https://www.npmjs.com/package/@skillcdn/cli) | the `skillcdn check` command: reads a repository as SkillCDN would index it (`npx @skillcdn/cli check`) |
| [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer) | [![npm](https://img.shields.io/npm/v/@skillcdn/indexer)](https://www.npmjs.com/package/@skillcdn/indexer) | the reading rules: a commit or a working tree read into an index |
| [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core) | [![npm](https://img.shields.io/npm/v/@skillcdn/core)](https://www.npmjs.com/package/@skillcdn/core) | the contracts: addresses, the convention, tool and REST schemas, the ports |


| | hosted (skillcdn.ai) | self-hosted / air-gapped |
|---|---|---|
| runtime | the container image, on AWS | the same image with compose |
| database | managed PostgreSQL | bundled PostgreSQL container |
| file cache | S3 | MinIO or local disk (S3-compatible) |
| git signal | GitHub App webhooks | GitLab / Gitea webhooks, or periodic pull |

## Development

```sh
pnpm install          # needs pnpm 12+; the Node.js runtime is pinned and fetched by pnpm
pnpm check            # lint, build, typecheck, test
```

Setup details and the contribution process are in [CONTRIBUTING.md](CONTRIBUTING.md). The rules of the codebase, for people and AI agents alike, are in [CLAUDE.md](CLAUDE.md). Secrets are never committed; `.env.example` holds example values only.

## License

SkillCDN is **source-available** under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md) (`FSL-1.1-ALv2`).

- Use it, modify it, self-host it and build on it, commercially or not.
- The one thing reserved is offering this software, or something substantially similar built from it, to others as a competing commercial product or service.
- Every release becomes Apache 2.0 two years after it is published.

This summary is not the license; [LICENSE.md](LICENSE.md) is. The specifications in [docs/specs/](docs/specs/) are licensed under the [Apache License 2.0](docs/specs/LICENSE), so that anyone may implement the format and the tools. "SkillCDN" and its logos are trademarks of KDX Labs Corp. and are not licensed with the code; see [TRADEMARKS.md](TRADEMARKS.md), which also allows everyone the format's file name and front-matter key. The hosted service at `skillcdn.ai` is operated by KDX Labs. Fonts bundled with the web UI have licenses of their own; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

Built by KDX Labs. Copyright (c) 2026 KDX Labs Corp.
