# SkillCDN

> **Status: pre-alpha.** This README describes what we are building. [docs/roadmap.md](docs/roadmap.md) says what exists today. Nothing here is a commitment to a public API yet.

**SkillCDN turns any git repository into an MCP server.** Point an agent at `skillcdn.ai/gh/<owner>/<repo>` and it gets the skills, playbooks and documents in that repo as tools. No hosting, no packaging, no publish step: the repo *is* the skill.

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
4. Without the GitHub App the index refreshes on a schedule. With the App installed, push webhooks refresh only what changed.

### Private repo

1. An org admin installs the SkillCDN GitHub App and **selects which repos** it may read. Permissions are contents and metadata, read-only.
2. A user adds the address to their agent. The agent starts MCP OAuth; we hand off to GitHub login and receive a user token. The GitHub token stays server-side; the agent only ever holds a SkillCDN token.
3. On every request we ask GitHub whether this user can see this repo and cache the yes/no for a few minutes. Teams, outside collaborators, internal repos, SSO enforcement: GitHub decides, we relay.
4. Indexing uses the App installation token, never a user token. Membership, team and repo-visibility webhooks invalidate the permission cache.

Headless agents get a **project token**: repo-scoped, read-only, expiring, revocable, issued by someone with admin on that repo. That is the only permission layer of our own.

### Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `find` | search over skill descriptions and documents in the mounted repo |
| `get` | return a skill or playbook by name, with its front-matter and body |
| `read_file` | read a file, or list a directory, inside the mounted ref |
| `intake` | *(later)* walk a non-expert through the questions a skill declares |
| `describe` / `run` | *(later)* composed tools declared in Markdown or YAML |

Every skill is also offered as an MCP prompt, so that a client which turns prompts into commands lets a person call a skill up by name; and the server tells the agent which skills a repository holds as soon as it connects.

The repo declares things; it never ships code that we execute. This is a deliberate security boundary: SkillCDN runs no third-party code, on the server or on the user's machine.

Specifications: [address scheme](docs/specs/address.md) · [skill-repo convention](docs/specs/skill-repo.md) · [tools](docs/specs/tools.md).

## Architecture

```
[agent]      any MCP client
     |   skillcdn.ai/gh/<owner>/<repo>[@ref][/path]   OAuth, or anonymous for public read
[api]        stateless MCP over HTTP · permission check · meta tools · REST for the web app · webhook receiver
[worker]     index and re-index on webhook or schedule   (same image as api, different role)
[postgres]   content index (full-text) · permission cache · job queue · later: vectors
[git host]   GitHub (App) · GitLab / Gitea (self-hosted, air-gapped)
```

One image with several roles, one database, caches keyed per repo and never per user, an optional web UI, and git hosts behind one adapter interface. The full picture is in [docs/architecture.md](docs/architecture.md); the decisions behind it are in [docs/adr/](docs/adr/).

## Repository layout

TypeScript monorepo: pnpm workspaces, Turborepo, Node.js 24, PostgreSQL 18.

```
apps/
  server/     the single deployable; roles: api | worker | migrate     Hono + MCP SDK
  web/        optional web UI: landing page and explorer              Vite + React
packages/
  core/       address parser, skill-repo convention, permission rules, tool contracts, ports   pure TS
  db/         schema, migrations, query layer                           Drizzle + PostgreSQL
  github/     GitHub App, user-token and contents adapter               implements the git-host port
apps/server/fixtures/.repositories/  test-only repository fixtures
deploy/       Dockerfile, compose files, the contract for whoever operates the image
docs/         architecture, specs, ADRs, roadmap
```

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

This summary is not the license; [LICENSE.md](LICENSE.md) is. "SkillCDN" and its logos are trademarks of KDX Labs Corp. and are not licensed with the code; see [TRADEMARKS.md](TRADEMARKS.md). The hosted service at `skillcdn.ai` is operated by KDX Labs. Fonts bundled with the web UI have licenses of their own; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

Built by KDX Labs. Copyright (c) 2026 KDX Labs Corp.
