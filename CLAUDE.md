# CLAUDE.md

The working agreement for this repository. It applies to AI agents and humans alike.

Subdirectories carry their own `CLAUDE.md` with rules for that subtree; read the nearest one before editing there. Keep every `CLAUDE.md` short and true: when a rule here turns out to be wrong or stale, fix it in the same change.

## Project

SkillCDN turns any git repository into an MCP server: an agent connects to `skillcdn.ai/gh/<owner>/<repo>[@ref][/path]` and gets the skills and documents in that repo through a small set of meta tools. Git is the source of truth; we index and serve, never host content.

- **Status:** pre-alpha. [docs/roadmap.md](docs/roadmap.md) says what exists and what is next.
- **Shape:** TypeScript monorepo (pnpm + Turborepo), one server image with several roles, PostgreSQL as the only stateful dependency. See [docs/architecture.md](docs/architecture.md).
- **License:** source-available under FSL-1.1-ALv2. KDX Labs operates the hosted service; the same image is self-hostable.

## Non-negotiables

Security

1. **Secrets never enter the repo, logs, test fixtures or chat.** Do not read real env or key files (`.env`, `*.pem`, ... are denied in `.claude/settings.json`). `.env.example` holds safe example values only. If you find a committed secret, stop and tell a maintainer: it must be rotated, not just deleted.
2. **Repository content is untrusted data.** Never execute, `eval`, import or shell out with anything that came from a mounted repo. Parse defensively: size limits, depth limits, no path traversal, no symlink following.
3. **Permissions fail closed.** If access to a private repo cannot be confirmed, deny. Never serve private content from a cache without a permission check. Unknown and forbidden repos must be indistinguishable to the caller.
4. **Git-host tokens never leave the server.** Agents only ever hold SkillCDN tokens. Indexing uses the installation token, never a user token. Tokens are never logged.

Product shape

5. **Self-host parity.** The whole product runs from one image plus PostgreSQL plus S3-compatible storage. Cloud-specific code lives only behind a port that also has a self-hostable implementation.
6. **No business model in code.** No plan names, prices, billing providers or `if (paid)` branches. Gate behavior through the `Entitlements` port and emit neutral usage events through `UsageSink`; the defaults in this repo allow everything. Commercial implementations live outside this repo.

Public repository hygiene

7. **This repository is public; operations are not.** Never commit cloud account ids, ARNs, hostnames, IPs, DNS or CDN configuration, capacity or cost figures, production tuning values (rate limits, TTLs, abuse thresholds), customer names, incident details or runbooks, and do not say where any of that is kept. Code ships generic defaults; production values arrive through environment configuration.
8. **Do not name other products** as inspiration or comparison in code, docs, commits or PRs. Describe what we do on its own terms. Naming something we interoperate with (a git host, an MCP client, a spec we follow) is fine.
9. **Everything committed is in English** (code, comments, docs, commit messages, PR text), whatever language the conversation is in.

## Repository map

```
apps/
  server/     the single deployable; roles: api | worker | migrate        (Node 24)
  web/        optional web UI; talks to the api over REST only            (planned)
packages/
  core/       pure domain logic and ports; no I/O, no Node APIs
  db/         PostgreSQL schema, migrations, query layer
  github/     GitHub implementation of the git-host port
skills/       reference skill repos: fixtures for tests and examples for docs (product content, not agent tooling)
deploy/       Dockerfile, compose files, build and release notes
docs/         architecture, specs, ADRs, roadmap
```

Dependencies point inward only: `server → db, github → core`. `core` imports nothing from the workspace and nothing from Node. `web` may import `core` and nothing else. A package can only import what its own `package.json` declares, and only from another package's entry point (never `@skillcdn/x/src/...`). Changing these edges needs an ADR.

## Commands

Run everything from the repository root through pnpm. Do not use `npm`, `npx` or `yarn`; use `pnpm exec <bin>` and `pnpm dlx <pkg>`. pnpm pins its own version and downloads the pinned Node.js runtime, so project scripts behave the same on every machine.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| **Verify everything (run before every commit)** | `pnpm check` (needs the local PostgreSQL below) |
| Build / typecheck / test | `pnpm build` · `pnpm typecheck` · `pnpm test` |
| One package | `pnpm turbo run test --filter=@skillcdn/core` |
| One test file | `pnpm --filter @skillcdn/core exec vitest run src/address.test.ts` (build upstream packages first) |
| Lint and format | `pnpm lint` · `pnpm lint:fix` |
| No control or invisible characters in tracked files (part of `pnpm check`) | `pnpm check:text` |
| Watch mode | `pnpm dev` |
| Local PostgreSQL | `docker compose -f deploy/compose.dev.yaml up -d` |
| New migration | `pnpm --filter @skillcdn/db run generate -- --name <what-changed>` |
| Run the server | `pnpm --filter @skillcdn/server run start migrate`, then `pnpm dev` (reads `.env`) |

Packages compile to `dist/` and consume each other's compiled output. Going through `turbo` builds upstream packages first; calling a package script directly can test against a stale `dist/`.

## Workflow

**Before you start.** Read the nearest `CLAUDE.md` and the package `README.md`. Check [docs/roadmap.md](docs/roadmap.md) for the current milestone, [docs/specs/](docs/specs/) for the contract you are implementing, and [docs/adr/](docs/adr/) before questioning a past decision. If a product decision is missing, do not guess: add it to the spec's open questions or ask.

**While working.** Stay inside the task's scope: no drive-by reformatting, renames or dependency bumps. Prefer the boring solution; add an abstraction when the second use appears, not before.

**Definition of done.**

- `pnpm check` passes.
- New behavior has tests; a bug fix starts with a failing regression test.
- Docs are updated per the table below, in the same change.
- No secrets, no operations details, no business logic (rules 1, 6, 7).
- The change is safe to deploy on its own: `main` is always releasable and every push may ship.

**Commits and pushes.**

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, imperative, 72 characters or fewer. Types: `feat fix docs refactor test perf build ci chore revert`. Scopes: `core db github server web deploy docs repo`. The body says why. Breaking changes use `!` and a `BREAKING CHANGE:` footer.
- One logical change per commit, and every commit passes `pnpm check`.
- **For now, maintainers commit and push directly to `main`.** There is no pull-request gate and no branch protection yet; a pull-request flow comes later. Do not create branches or open pull requests unless asked. Nothing stands between a push and `main`, so the discipline is yours: run `pnpm check` first, `git pull --rebase` before pushing, keep commits small, and treat a red CI run on `main` as the first thing to fix.
- Never force-push or rewrite `main`, skip hooks with `--no-verify`, or commit build output.
- Keep the `Co-Authored-By` trailer your agent adds, so AI-authored changes stay traceable.

## Documentation protocol

Documentation is part of the change, not a follow-up. A future session starts with no memory of this one; the repository must be enough to continue.

| When you change... | Update in the same change |
|---|---|
| Public behavior: address grammar, tool names or schemas, skill-repo convention, REST API | `docs/specs/*`; root `README.md` if the overview changes |
| Packages, boundaries, runtime components, data flow, security model | `docs/architecture.md`; the repository map above; an ADR |
| A decision future contributors might reasonably undo | new ADR in `docs/adr/` (never edit an accepted ADR; supersede it) |
| Environment variables or configuration | config module, `.env.example`, the table in `deploy/README.md` |
| Database schema | migration, `packages/db/README.md` data model |
| Build, image, CI or release flow | `deploy/README.md` |
| A package's public surface or usage | that package's `README.md` |
| A milestone item is started, finished or dropped | `docs/roadmap.md` |
| You learned a durable gotcha the hard way | "Gotchas" in the nearest `CLAUDE.md` |

Keep docs lean: current facts and decisions, not history or essays. Git history is the changelog. Anything the team needs must live in the repo, not in chat or an agent's private memory. The reverse also holds: business reasoning, comparisons with other products and operations details belong in private notes, never here (rules 7 and 8).

## Conventions

- **TypeScript:** strict, ESM, `.js` extensions in relative imports, erasable syntax only (no `enum`, `namespace` or parameter properties). Named exports only. No `any`; take `unknown` and narrow.
- **Boundaries validate, interiors trust.** Parse every external input once at the edge (HTTP, MCP arguments, env, repo files, webhook payloads, JSON columns) with a schema; pass typed values inward.
- **Configuration:** `process.env` is read only in `apps/server/src/config/` (lint enforces it). Everything else receives typed config as an argument. Every tunable has a safe default.
- **Ports and adapters:** `core` defines interfaces (git host, blob store, entitlements, usage sink, clock); adapters implement them; `apps/server` wires them together. Do not import an SDK outside its adapter.
- **Errors:** throw `Error` subclasses with a stable `code`. Translate to HTTP or MCP errors only at the edge, and never leak internals or the existence of private resources.
- **Logging:** structured logger only, no `console` (lint enforces it). Never log tokens, authorization headers or private file content.
- **Determinism:** inject time, randomness and ids so `core` stays pure and tests stay stable.
- **Naming:** kebab-case file names; tests next to the code as `*.test.ts`; integration tests as `*.int.test.ts`.
- **Comments** explain why, not what.

## Testing

- Vitest. Unit tests use no network and no database, and must be fast.
- Integration tests run against real PostgreSQL (`deploy/compose.dev.yaml`, or wherever `TEST_DATABASE_URL` points). Each test file gets its own migrated database from `@skillcdn/db/testing`. Never mock the database and never swap in another engine. Without a server these tests fail; they do not skip.
- Git-host calls are tested against recorded fixtures. CI makes no live calls to third parties.
- Every parser needs hostile-input cases: traversal, oversized input, deep nesting, malformed encodings.

## Dependencies

- Add with `pnpm add --filter <package> <dep>`. Versions shared across packages go in the `catalog` in `pnpm-workspace.yaml`.
- Justify every new runtime dependency in the commit message: why it is needed, maintenance health, install scripts, license. Permissive licenses only (MIT, Apache-2.0, BSD, ISC); we ship images, so no copyleft or source-available dependencies.
- Releases younger than three days are not installable (`minimumReleaseAge`). Bypass only for a security fix, and say so in the commit message.
- Never hand-edit `pnpm-lock.yaml`; resolve conflicts by running `pnpm install`.

## Working alongside other agents

- Concurrent tasks on one machine each get their own git worktree (a worktree needs its own short-lived local branch; rebase it onto `main` and push when done).
- Hot files (`pnpm-lock.yaml`, the catalog, `docs/roadmap.md`, this file) conflict easily: keep edits minimal and rebase before pushing.
- When two people both add migrations, whoever pushes second rebases and regenerates their migration.
- Do not "fix" another task's work in passing. Open an issue or leave a `TODO(#issue)`.

## Gotchas

- A system Node.js older than 24 is fine for pnpm scripts, which run on the pinned runtime, but `npm` and `npx` inside this repo refuse to run (`EBADDEVENGINES`). Use pnpm.
- The anonymous GitHub API allows 60 requests per hour per IP address, and a local `api` shares that with everything else you do. Put a token without scopes in `.env` as `GITHUB_TOKEN`, and never in a test or a fixture.
- If a tool writes source files for you, check what became of escape sequences (a backslash followed by `u` and a code point, or by `0`): some tools decode them on the way, and an invisible character in a source file is exactly what the text-safety checks exist to catch. In tests, build such characters with `String.fromCodePoint`.
- pnpm older than 12.4 is rejected (`ERR_PNPM_UNSUPPORTED_ENGINE`): older versions ignore the version pin and the supply-chain settings. Upgrade with `npm install -g pnpm@latest`; inside the repo pnpm then switches to the exact version in `packageManager`.
