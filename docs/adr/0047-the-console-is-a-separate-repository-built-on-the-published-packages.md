# ADR-0047: The console is a separate repository, built on the published packages

- Status: Accepted
- Date: 2026-10-09

## Context

The roadmap listed a work board for parallel agents among the things left undecided. The maintainers are building it as the console, `skillcdn/console`: where an organization runs its work with AI agents, a board of the work, the agents at it, what each is doing, and the decisions that wait for a person. The organization's own playbooks reach those agents through SkillCDN. It is to consoles what `skillcdn/skills` is to skill repositories: a reference, an example that follows the standard and is meant for real use, packaged so that anyone can start from it. It is not the UI of a deployment of this server (`apps/web` is that: landing page, explorer, account pages), and not part of the specification, which a repository in the format and a reader of it owe nothing to.

A repository that holds a specification and its reference implementation is best kept complete on its own. User interfaces built around such a product are generally kept in repositories of their own, consuming its public surface, so that the standard stays small and the example can move at its own pace.

## Decision

1. **The console lives in its own repository**, `skillcdn/console`, with its own versions, releases, CI and documentation, as the reference console: an example that follows the standard and is meant for real use, not a second standard. Its package, `@skillcdn/console`, is published to npm under the same scope, by the same means as the packages here ([ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md)), so that anyone can build their own console from it.
2. **It depends on this repository only through what is published:** the npm packages (`@skillcdn/core` first) and the REST API of a deployment. Never a workspace link, a path into this repository, the database package or the image.
3. **Nothing in this repository depends on the console,** imports it, or branches for it. The image, the web UI and the specification are complete without it. This repository knows the console through this ADR and the links that point at it, and nothing else.
4. **What the console needs from a package here is proposed, released and adopted** as any other consumer's need would be: a change here with its changeset, a release, then a version bump there. The console is the first consumer of the packages outside this repository, and so the first test of their surface.
5. **`apps/web` stays the UI of a deployment:** landing page, explorer and account pages, and nothing of the console's.

## Consequences

- The published surface of the packages is what the console can use. A need there becomes a release here, which keeps the surface honest and the changelogs real.
- Two repositories to keep in step: a breaking release of a package here is adopted there deliberately, by its version, never at once.
- The console's own rules, what an agent may do and how work is recorded, never enter this repository.
- Rejected: `apps/console` in this monorepo (ties the standard to a product that is not part of it, and the image and CI to that product); a module of `apps/web` (a deployment's UI shows what the deployment serves, to everyone; the console shows an organization's own work, to its members, from a database of its own); copying code from here into the console (two copies of the contracts drift).
