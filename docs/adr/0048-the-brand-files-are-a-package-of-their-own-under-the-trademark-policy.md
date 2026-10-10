# ADR-0048: The brand files are a package of their own, `@skillcdn/brand`, under the trademark policy

- Status: Accepted
- Date: 2026-10-10

## Context

The pictures of the brand, the symbol, the wordmark, the lockup and the icons made from them, lived in the web UI's `public/` directory, since the pages were the one place that served them; their shapes are the path data in `core`, and a test kept the files equal to it. A second consumer appeared: the reference console ([ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)) shows the marks in its default build, consumes this repository only through what is published, and is under MIT, so it can neither copy the files nor reach into this repository for them; its own decision record asks for a package of this repository that carries them and says who may show them. The marks are trademarks of KDX Labs and not licensed with the code ([ADR-0001](0001-license-and-trademarks.md), `TRADEMARKS.md`); a package under `FSL-1.1-ALv2` would say the wrong thing about them.

## Decision

1. **`packages/brand` (`@skillcdn/brand`) holds every picture of the brand**: the SVG files written out from the path data in `core`, and the raster files its script draws from the same data (the symbol, the lockups, the account picture, the banner, the favicons, and the opaque tiles for home screens and web app manifests). It ships no code: each file is an export of the package by its path, so that a bundler gives back its address, and there is no entry point.
2. **The files are licensed under the trademark policy and nothing else.** The package carries its own `LICENSE.md`, under the directory-license clause of ADR-0001: the files are trademarks and copyrighted works of KDX Labs, not open source, not under the code's license nor under that of whatever depends on the package, and usable only as the SkillCDN Trademark Policy allows. The policy ships with the package as `TRADEMARKS.md`, copied from the repository's root at pack time so that the text has one source, and `"license"` says `SEE LICENSE IN LICENSE.md`.
3. **The web UI consumes the package.** `apps/web` depends on `@skillcdn/brand` and serves its files at the addresses it always had, the icons at the root of the site and the rest under `/brand/`, in development and in the build. The dependency edges become `web → core, brand`; `brand` depends on nothing, and uses `core` and a canvas only to draw and test its files.
4. **It is versioned and published as the other packages are** ([ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md)): a changeset per change, the release workflow, trusted publishing, a first version by hand. A change of a mark is a change of the path data in `core`, a run of the script, and a release of both packages.

## Consequences

- A page that may show the marks shows the files of skillcdn.ai, from one place, instead of a copy; the reference console's default build depends on the package and passes the addresses to its brand slot, and a console of someone's own brings its own marks.
- Links into the repository that named the old paths change: the READMEs of the published packages show the symbol from the new path and are republished with their next versions.
- The policy is the one text that says who may show the marks; the package adds no permission and takes none away. A use the policy does not answer is a question for the maintainers, not for the package.
- Rejected: the console copying the files (trademarked files in an MIT repository, and a copy that drifts); data URLs or path data in the console (a copy by another name); loading them at run time from a deployment (a page's own frame depending on the network); publishing them under `FSL-1.1-ALv2` like the code (that license says nothing about the marks, and the policy does); packing the web UI's files without moving them (a package reaching into an app's directory, the dependency pointing the wrong way).
