# ADR-0008: This repository ends at an image that builds

- Status: Accepted
- Date: 2026-09-22
- Supersedes: [ADR-0005](0005-public-repository-private-operations.md)

## Context

ADR-0005 drew the line between this public repository and the operation of the hosted service, and kept one foot across it: a workflow here published images to a cloud registry, with the account wiring supplied through GitHub variables. That workflow is part of how one particular deployment is operated: which registry, which accounts, which environments, what gates a release. None of it helps someone who builds, runs or changes the product, and everything a deployment needs from this repository can be stated without it.

## Decision

**In this repository:** product code, tests, the container image definition, local development and self-hosting assets, CI that verifies every change (including that the image builds and behaves), and documentation of architecture, public contracts and decisions.

**Outside this repository:** building and publishing release images, registries, deployment pipelines, cloud infrastructure definitions and state, DNS, CDN and edge configuration (rate limiting included), environment-specific values, runbooks and incident notes, production tuning values, anything about pricing, plans or billing, and commercial or enterprise-only modules.

The hand-off is [`deploy/README.md`](../../deploy/README.md): how to build the image from a commit, its roles, its environment contract and its rollout rules. Code that needs a tunable ships a safe generic default and reads the real value from configuration. Commercial behavior attaches through the extension points in [`architecture.md`](../architecture.md), never through conditionals in this codebase.

## Consequences

- Anyone can build and run the full product from this repository alone. A deployment pins a commit of this repository, preferably one whose CI run is green, and builds the image from it.
- No cloud account, role or registry is associated with this repository. Its workflows need no secrets and run safely on pull requests from forks.
- A published image for self-hosters is a product decision that arrives with the self-hosting bundle, not a side effect of how one deployment is operated.
- Changes that add account identifiers, hostnames, capacity or cost figures, plan names or pricing logic are not acceptable, whatever the justification.
- Some knowledge deliberately has no home here.
- Rejected: keeping the publishing workflow and gating it on CI (it ties a public repository to the accounts and the release policy of one deployment).
