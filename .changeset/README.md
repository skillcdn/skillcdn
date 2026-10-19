# Changesets

A changeset says what a change means to whoever installs a published package: which packages, which bump, and a line or two written for them. `pnpm changeset` writes one into this directory; a file by hand does the same:

```md
---
"@skillcdn/cli": minor
---

`skillcdn check` prints the license of each skill.
```

Bumps, while the major is 0 ([ADR-0058](../docs/adr/0058-the-published-packages-share-one-version.md)): `patch` for a fix or an addition that changes nothing that exists, so that a consumer takes it without reading; `minor` for a change that can break a program written against the previous version, and its entry begins with `Breaking:`. The test is compatibility, not novelty: a name removed or renamed, an input that accepts less, an output that may now hold more (a field that becomes nullable, for one) or a meaning that changed is breaking; a new export, a new optional field or an input that accepts more is not. Never `major`: it would make the version `1.0.0`. Every published package is released at the same version, and a change to any of them without a changeset is not released until one is added.

The release workflow turns the pending changesets into one pull request that bumps versions and changelogs; merging it publishes ([ADR-0046](../docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)).
