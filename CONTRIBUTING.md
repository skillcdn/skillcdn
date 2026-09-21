# Contributing to SkillCDN

Thanks for your interest. SkillCDN is pre-alpha and moving quickly, so please open an issue before starting anything larger than a small fix: the design may already be changing under you.

The rules for working in this codebase (conventions, testing, commits, documentation) are in [`CLAUDE.md`](CLAUDE.md). They apply to people and AI agents alike. This file covers setup and the contribution process.

## Setup

You need:

- **pnpm 12 or newer** (`npm install -g pnpm@latest`, or Corepack). pnpm then pins its own exact version and downloads the pinned Node.js 24 runtime for project scripts; both are verified against the lockfile.
- **Docker**, for the local PostgreSQL and for building the image.
- Node.js 24 as your system Node.js is recommended so editors and ad-hoc commands match. It is not required for pnpm scripts.

```sh
pnpm install
pnpm check                                          # lint, build, typecheck, test: must pass before every commit
docker compose -f deploy/compose.dev.yaml up -d     # PostgreSQL 18 on 127.0.0.1:5432
cp .env.example .env
pnpm dev
```

## Process

1. Make one logical change. Add tests. Update the docs listed in the "Documentation protocol" table in `CLAUDE.md`.
2. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.
3. Run `pnpm check`.
4. **Maintainers** currently push directly to `main` (`git pull --rebase` first); a pull-request flow will replace this later. **Everyone else:** fork, open a pull request against `main` and fill in the checklist.

Found a security problem? Do not open an issue. Follow [`SECURITY.md`](SECURITY.md).

## License of contributions

SkillCDN is licensed under [FSL-1.1-ALv2](LICENSE.md); names and logos are covered by [`TRADEMARKS.md`](TRADEMARKS.md).

KDX Labs licenses the project as a whole, including under commercial terms and, two years after each release, under Apache 2.0. To keep that possible, contributions are accepted under these terms:

- You keep the copyright in your contribution.
- You grant KDX Labs Corp. a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, distribute and sublicense your contribution, and to license it to others under any terms, together with a patent license covering your contribution as submitted.
- You confirm that you wrote the contribution or otherwise have the right to submit it under these terms, and that it is provided as is.

Before a first external pull request can be merged we will ask you to accept these terms through a contributor license agreement check on the pull request. If your employer owns your work, make sure they agree too.

Please do not submit code copied from projects under copyleft or source-available licenses, and do not add dependencies under such licenses.
