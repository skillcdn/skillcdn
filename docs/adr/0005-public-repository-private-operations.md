# ADR-0005: What lives in this repository and what does not

- Status: Accepted
- Date: 2026-09-21

## Context

The code is public and the hosted service is run by KDX Labs. Contributors and self-hosters need everything required to build, run and change the product. They do not need, and should not get, the details of how the hosted service is operated or sold.

## Decision

**In this repository:** product code, tests, the container image definition, local development and self-hosting assets, CI, the workflow that publishes an image to a registry, and documentation of architecture, public contracts and decisions.

**Outside this repository:** cloud infrastructure definitions and state, DNS, CDN and edge configuration, environment-specific values, runbooks and incident notes, production tuning values, anything about pricing, plans or billing, and commercial or enterprise-only modules.

The hand-off between the two is narrow and documented in [`deploy/README.md`](../../deploy/README.md): a published image, its roles, its environment contract and its rollout rules. Code that needs a tunable ships a safe generic default and reads the real value from configuration. Commercial behavior attaches through the extension points in [`architecture.md`](../architecture.md), never through conditionals in this codebase.

## Consequences

- Anyone can build and run the full product from this repository alone.
- Changes that add account identifiers, hostnames, capacity or cost figures, plan names or pricing logic are not acceptable, whatever the justification.
- Workflows take every account-specific value from GitHub variables, authenticate with short-lived OIDC credentials and mask identifiers in logs.
- Some knowledge deliberately has no home here.
