# ADR-0003: One deployable with `api`, `worker` and `migrate` roles

- Status: Accepted
- Date: 2026-09-21

## Context

The hosted service and self-hosted installs must run the same build. The HTTP surface and the background indexer share almost all of their code, and the smallest install has to work as a single container that also refreshes its index.

## Decision

There is one server workspace, `apps/server`, and one container image. The container command selects the role: `api`, `worker` or `migrate`. A configuration flag lets `api` run the worker loop in-process for single-container installs. Roles load their heavy dependencies lazily so one role does not pay for another.

## Consequences

- One artifact to build, scan, publish and reason about; hosted and self-hosted cannot drift.
- Migrations are a first-class, separately runnable step, which a safe rollout needs.
- Shared logic does not have to be forced into a package just so two apps can import it; modules stay in `apps/server` until a second consumer exists.
- The image carries every role's dependencies. If that ever hurts (for example a large model runtime used only by `worker`), splitting the image is a contained change.
- Rejected: separate `api` and `worker` apps (two artifacts, and the in-process mode would need the worker's code in a shared package from day one).
