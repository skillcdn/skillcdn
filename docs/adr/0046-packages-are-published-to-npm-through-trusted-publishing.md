# ADR-0046: Packages are published to npm from this repository, through trusted publishing

- Status: Accepted
- Date: 2026-10-09
- Amends: [ADR-0008](0008-repository-ends-at-an-image-that-builds.md) (the one workflow that may publish anything)

## Context

ADR-0008 ends this repository at an image that builds: no workflow here logs in to a registry, and none needs a secret, so that no account of one deployment is tied to a public repository. The roadmap asks for packages on npm under the `@skillcdn` scope, so that an author checks a repository without the image ([ADR-0045](0045-the-indexer-is-a-package-and-check-is-a-command.md)) and the contracts in `core` can be used by other tools. A public package registry is a product channel like the git repository itself, not the operation of one deployment: what is published is the same for everyone who installs it.

The npm registry accepts a publish from a GitHub Actions workflow on the strength of a short-lived identity the job proves with OpenID Connect (its "trusted publishing"), with no stored token, and attaches a provenance attestation that names the commit and the workflow. It does not accept the first version of a package that way.

## Decision

1. **Published:** `@skillcdn/core`, `@skillcdn/indexer` and `@skillcdn/cli`, with independent semantic versions starting at `0.1.0`. Before `1.0.0`, a minor version may change the surface; the changelog of each package says what changed. Not published: `apps/server`, `apps/web`, `packages/db` and `packages/github`, which exist for the image. The server keeps no version of its own: a deployment pins a commit (ADR-0008).
2. **Versions and changelogs come from changesets.** A change to a published package carries a `.changeset/*.md` file that names the packages, the bump and what the change means to whoever installs it. On `main`, the release workflow turns the pending changesets into one pull request that bumps versions and changelogs; merging it publishes the new versions, tags them and makes a GitHub release for each.
3. **The release workflow publishes through trusted publishing and nothing else.** It holds no secret and no token: the job that publishes has `id-token: write`, and every published version carries provenance. This is the one exception to ADR-0008's rule, limited to the public package registry under the project's own scope; nothing about an image, a registry of images or a deployment enters this repository with it.
4. **The first version of a new package is published by a maintainer by hand**, from a checkout of the commit on `main`, and its trusted publisher is registered on the registry right after. From then on, only the workflow publishes.
5. **What a package carries:** its compiled `dist/`, its `README.md` written for whoever installs it, and the repository's `LICENSE.md`, copied in at pack time so that the text has one source. Dependencies between the packages are version ranges (`workspace:^`), rewritten by the package manager when it packs.

## Consequences

- `pnpm check` is unchanged. A change to a published package without a changeset is not released until someone adds one; the definition of done in `CLAUDE.md` asks for it with the change.
- The workflow needs the repository setting that lets Actions open pull requests, and each package needs its trusted publisher registered on the registry; both are in the settings checklist of `deploy/README.md`, since neither can be expressed in files here.
- A bump of `INDEX_VERSION` is a release of `@skillcdn/indexer` as much as a change of the server; the server picks it up through the workspace, as before.
- Rejected: a token stored as a repository secret (long-lived, and what ADR-0008's rule exists for); publishing from a maintainer's machine only (no provenance, and a release that depends on one person's setup); versions derived from commit messages (the commit log says what changed in the repository, not what a package's users need to know); one version for all packages (a fix in the command would release the library).
