# apps/web (planned)

The optional web UI: landing page, explorer over the public index, git-host login, repo connection. Planned stack: Vite + React + TypeScript.

**Status:** not started. It is scaffolded when its roadmap item begins, so no unused dependencies sit in the workspace until then. The first version is the landing page and the explorer; login and repo connection arrive with private-repository support ([roadmap](../../docs/roadmap.md)).

**Before building anything here, ask the maintainers about design and branding**: logo, colors, typography, tone, languages, what the landing page says. The brand is not part of what this repository licenses ([TRADEMARKS.md](../../TRADEMARKS.md)), and it is not something to improvise. Do not pick a component library's default look or invent a logo to get started.

## Constraints that already hold

- **Optional.** A deployment with no web UI must work. Nothing in `apps/server` may depend on this workspace.
- **REST only.** The UI talks to the `api` role over its public REST surface. It may import types and the address parser from `@skillcdn/core`, and nothing else from the workspace.
- **Static output.** The build is plain static files that the `api` role or any static host can serve.
- **No secrets in the client.** Everything in a browser bundle is public, including every `VITE_*` variable.
- **No business model in the UI code** either: plans, prices and checkout do not live in this repository (root `CLAUDE.md`, rule 6).

When scaffolding: add `package.json` as `@skillcdn/web`, follow the script names of the other workspaces (`build`, `typecheck`, `test`, `dev`), add this workspace to the repository map in the root `CLAUDE.md` and to `docs/architecture.md`, and add a `CLAUDE.md` here.
