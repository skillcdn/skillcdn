# ADR-0058: The published packages share one version

- Status: Accepted
- Date: 2026-10-18
- Amends: [ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md) (point 1, the independent versions, and the option it rejected)

## Context

Seven packages are published now, and they are the layers of one thing: `core` under `indexer`, `reader` and `client`, `serve` over the reader, `cli` over all of them, `brand` beside them. The console, the web UI and the command install several at once. Under ADR-0046 each package had a version of its own, and after a year of releases they read `core` 0.2.1, `indexer` 0.2.2, `cli` 0.1.4, `brand` 0.1.1, with three new packages at nothing: which versions go together was a question with no answer written anywhere, and the ranges between the packages were the only record of it.

ADR-0046 rejected one version for all packages because a fix in the command would release the library. That cost is a tarball per package per release. The cost of independent versions is borne by everyone who installs more than one package, every time.

## Decision

1. **One version for every published package.** The seven are a fixed group in `.changeset/config.json`: a release bumps all of them to the next version and publishes all of them, changed or not. "SkillCDN 0.3.0" names the set, and the first shared version is 0.3.0. A new package joins the group and starts at the shared version; its first version is still published by hand (ADR-0046, point 4).
2. **Semantic versioning, read for a line whose major is 0.** A patch (0.y.z) fixes and adds, and changes nothing that exists; a consumer takes it without reading. A minor (0.y) may change or remove a public surface, and every such change is the first thing its changelog entry says, as `Breaking:`. A changeset names `patch` or `minor` and never `major` while the major is 0. 1.0.0 comes when the specifications (addresses, the pack format, the tools, the REST API) are declared stable; from then on, major, minor and patch mean what semantic versioning says.
3. **What the promise covers**, per package: the exports of `core`, `indexer`, `reader`, `serve` and `client`; the reading rules `indexer` implements (a bump of `INDEX_VERSION` is a minor); the REST shapes `client` sends and parses; the commands, arguments, output and exit codes of `cli`; the file names of `brand`. The Node.js floor in `engines` is part of it: raising it is a minor.
4. **The packages are taken together.** Dependencies between them are `workspace:^`, published as a caret on the shared version, which on a 0.x line admits the patches of the same minor and nothing else. A consumer installs every `@skillcdn` package at one version and moves them together; a mix across minors is not supported, and the ranges refuse it.
5. **A surface leaves in two steps.** It is marked `@deprecated` with what replaces it and kept for at least one minor; a later minor removes it with a `Breaking:` entry.
6. **Changelogs, tags and releases stay per package**, as the tooling makes them: a change names the packages it touches and the bump; the group takes the highest bump; each package's changelog lists its own entries; each gets its tag and GitHub release, all carrying the same number.
7. **Private packages keep no version** (ADR-0046, point 1): `apps/server`, `apps/web`, `packages/db` and `packages/github` exist for the image, which pins a commit.

## Consequences

- A `minor` in any changeset makes the release a minor for the set, so the bump is chosen for the set: `minor` says that the set may break, `patch` that it does not. A fix in the command releases the library at the next number, with an empty entry; that is the cost accepted here.
- The README of the repository lists the packages at one version, and the architecture document says how they are versioned; the console pins the packages at one version.
- `pnpm changeset` still asks which packages changed, and the entry is still written for whoever installs that package; the group does the rest.
- Rejected: a linked group (packages that did not change keep their old number, and the numbers scatter again); one package holding everything (the browser-safe client would carry Node.js code, and a command would ship inside a library); a version per layer (three numbers to explain instead of one); a version file at the root with a script of our own (the tooling does this already).
