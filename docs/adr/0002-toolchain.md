# ADR-0002: Node.js 24, a pnpm-pinned toolchain and compiled TypeScript packages

- Status: Accepted
- Date: 2026-09-21

## Context

Most development here is done by AI agents across many machines and sessions. Environment drift (a different Node.js, a different package manager, a stale build) wastes more time than any tool saves. The project is also meant to run for years, so the runtime must be a supported LTS line and production must run plain, predictable JavaScript.

## Decision

- **Runtime:** Node.js 24 LTS, ESM only. We move to the next LTS line after it has been LTS for a few months.
- **Package manager:** pnpm, pinned in `packageManager`. The lockfile pins pnpm itself and, through `devEngines.runtime`, the exact Node.js build that project scripts run on. `.nvmrc` mirrors the major version for editors and CI.
- **Supply chain defaults:** `minimumReleaseAge` of three days, install scripts allowed only through `allowBuilds`, one version per shared tool through the workspace `catalog`.
- **Language:** TypeScript 7 in strict mode with `erasableSyntaxOnly`, `verbatimModuleSyntax` and `NodeNext` resolution.
- **Build:** every package compiles with `tsc -b` (project references) to `dist/` and is consumed through its `exports`. No bundler on the server. Turborepo orders and caches tasks.
- **Quality:** Biome for lint and format, Vitest for tests. Architectural rules that can be linted are linted (`process.env` only in the config module, no `console`, no undeclared dependencies, no floating promises).

## Consequences

- A fresh clone needs only pnpm 12 or newer; everything else is pinned and verified by the lockfile.
- `npm` and `npx` refuse to run inside the repo on a machine whose system Node.js is older than 24. Use pnpm.
- Development and production share the same module layout, so package-relative assets such as migrations resolve identically in both.
- The price is a build step between packages: a package script run directly can see a stale upstream `dist/`. Running tasks through Turborepo avoids it, and `CLAUDE.md` says so.
- Rejected: source-level internal packages plus a server bundle (simpler inner loop, but development and production layouts differ); running TypeScript directly in production (one less step, but a newer runtime feature and awkward with pruned installs).
