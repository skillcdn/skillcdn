# ADR-0102: A new package is held by a placeholder, and every version of it comes from the release workflow

- Status: Accepted
- Date: 2026-11-14
- Amends: [ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md), point 4 (the first version of a new package published by hand), and with it the same words in [ADR-0058](0058-the-published-packages-share-one-version.md), [ADR-0066](0066-the-inference-adapters-are-a-package-of-their-own.md) and [ADR-0101](0101-the-web-ui-is-published-as-a-package-that-builds-the-pages-with-an-installations-own.md)

## Context

The registry registers a trusted publisher only for a package it already has, so ADR-0046 had a maintainer publish a new package's first version by hand and register the publisher after. That version was the one version of the package without provenance: built and published from one person's machine, naming no commit and no workflow, and still a version people install.

## Decision

1. **A maintainer publishes a new package first as a placeholder**, version `0.0.0`, which holds the name and carries nothing of the package: a `package.json` with the name, the license and the repository, a `README.md` that says to install a later version, and the license. It is not built from the repository.
2. **The package's trusted publisher is registered right after**, with the publishing access every other package has.
3. **Every version with content is published by the release workflow, with provenance**, the first one included: the package joins the fixed group and is published at the version the next release gives it.

## Consequences

- The version list of such a package starts with `0.0.0`, and the registry's `latest` points at the placeholder until that release. The placeholder is published when the release is ready, not before.
- The version pull request is merged only once the placeholder is out and the publisher registered: until then the new package's publish fails, and the run is repeated once both are done ([deploy](../../deploy/README.md#repository-settings-checklist)).
- `@skillcdn/web` is the first package held this way, and its first version with content is 0.5.1. The versions of `@skillcdn/brand` and `@skillcdn/inference` that were published by hand stay as they are.
- Rejected: publishing the package's first real version by hand (the one version of it without provenance).
