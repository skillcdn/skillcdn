# ADR-0101: The web UI is published as a package that builds the pages with an installation's own

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0099](0099-the-pages-take-pages-of-an-installations-own-from-a-configuration-of-the-build.md) (pages of an installation's own from a configuration), [ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md) (how packages are published), [ADR-0058](0058-the-published-packages-share-one-version.md) (one version for all of them), [ADR-0048](0048-the-brand-files-are-a-package-of-their-own-under-the-trademark-policy.md) (the marks under the trademark policy) and [ADR-0049](0049-the-documentation-is-rendered-into-the-pages-from-the-repositorys-own-files.md) (the documentation rendered from the repository's own files).

## Context

ADR-0099 let an installation add pages of its own without a fork, and left one step for later: the build came from a checkout of this repository at the release, so an installation kept a clone, a workspace of pnpm and the toolchain of the whole repository, to build one workspace of it. What an installation wants is a small directory of its own that depends on a version: its configuration, its pages, and one command that makes what `WEB_ROOT` serves.

Three things a build took from the repository did not travel with the web workspace: the documentation, which the pages render from the repository's own files; the fonts and the notices of what the pages bundle, which a script read from the workspace's own installation; and the marks, which the pages show, and which a changed build may show only as the trademark policy says.

## Decision

1. **`@skillcdn/web` is published**, from the web workspace as it is, at the version every published package shares: the sources of the pages, the plugins of the build and its steps, not a build. Its first version is published by a maintainer, and the release workflow publishes the rest (ADR-0046).
2. **A command builds the pages.** `skillcdn-web build --config <file> --out <dir>` makes the directory `WEB_ROOT` serves, by the steps the workspace's own build takes, which now runs the same command: the pages, the render module, and every static page once per language with `routes.json`. It empties the output directory first, and refuses one that is the directory it runs in or above it, holds the configuration or the package, or holds anything but a build. `skillcdn-web dev` serves the pages for development, against the fixtures or against a deployment (`--api`).
3. **A configuration is written against the package.** It imports `defineSite` from `@skillcdn/web`, whose declarations the package carries, and what it imports of React, the REST client and `core` is the package's own, resolved once (ADR-0099). Vite and its React plugin are peers, installed beside the package: they build the pages and are no part of them.
4. **The documentation travels in the package.** `docs/nav.json`, every file it publishes, and the license of the format's specification beside its files are copied into the package when it is packed, at their paths from the repository root; a build that finds no checkout around it reads that copy. The documentation of an installation's pages is that of the release it built from.
5. **So do the notices.** The package carries the repository's license, the trademark policy and the third-party notices; the licenses of the fonts and the icons are among the public files of the pages. The notice of the npm packages the pages bundle (`licenses/npm.txt`) is written from what the build bundled, wherever it runs, so that it is right for an installation's build and lists what its own pages bring in as well.
6. **The marks stay, and stay ours.** A build made with the package and a configuration of an installation's own pages shows the SkillCDN name, symbol and wordmark where the pages show them, and may be served as the UI of that installation's deployment, to its people or to the public. The marks remain KDX Labs': an installation's pages may not use them for anything of the installation's own, and a build from changed copies of the package's own files is a modified build under the policy. The trademark policy says so.

## Consequences

- An installation is a directory with a `package.json` that depends on `@skillcdn/web` at the release its image is, Vite and its React plugin beside it, a configuration and its pages; `skillcdn-web build` makes the directory to mount over `/app/web` or to point `WEB_ROOT` at ([deploy](../../deploy/README.md#a-ui-with-pages-of-your-own)). A checkout of the release still works the same way.
- The image builds its pages as before, from the workspace, by the same command.
- The package is large, some thirteen megabytes: the pictures and the clips of the front page travel with it, since a deployment may show them.
- The package's files are now part of what is published: the list in its `package.json` is what a build in an installation has, and a file the build reads that is not on it fails there and nowhere else. A test builds the documentation from the copy the package carries and compares it with the checkout's.
- What a configuration is given stays additive only (ADR-0099), now with a published version behind each change.
- Not built, and undecided: replacing pieces of the pages (the header, a section of the front page), bringing a language, and marks of an installation's own.
- Rejected: publishing a build of the pages (it would have no pages of an installation's own). Rejected: remaking the workspace into a library of components with a composition of them (a rewrite of every page, for nothing an installation asked for that the configuration does not do). Rejected: leaving the documentation out of the package (the pages link to it from the header and the footer, and an installation's people read their release's).
