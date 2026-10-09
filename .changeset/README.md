# Changesets

A changeset says what a change means to whoever installs a published package: which packages, which bump, and a line or two written for them. `pnpm changeset` writes one into this directory; a file by hand does the same:

```md
---
"@skillcdn/cli": minor
---

`skillcdn check` prints the license of each skill.
```

Bumps: `patch` for a fix, `minor` for something new. Before `1.0.0`, a change that removes or renames something is `minor` as well: `major` would make the version `1.0.0`. A change to `@skillcdn/core`, `@skillcdn/indexer` or `@skillcdn/cli` without a changeset is not released until one is added.

The release workflow turns the pending changesets into one pull request that bumps versions and changelogs; merging it publishes ([ADR-0046](../docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)).
