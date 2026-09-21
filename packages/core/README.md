# @skillcdn/core

Pure domain logic. No I/O, no Node.js APIs, no workspace dependencies: it runs unchanged in the server, in tests and in a browser.

**Status:** empty entry point. First content arrives in milestone 1 ([roadmap](../../docs/roadmap.md)).

## What belongs here

| Area | Spec |
|---|---|
| Address parser and formatter | [specs/address.md](../../docs/specs/address.md) |
| Skill-repo convention parser (front-matter, layouts, manifests) | [specs/skill-repo.md](../../docs/specs/skill-repo.md) |
| Tool contracts: names, input and output schemas | [specs/tools.md](../../docs/specs/tools.md) |
| Permission rules: the decision logic, given facts fetched elsewhere | [architecture.md](../../docs/architecture.md#security-model) |
| Ports: git host, blob store, clock and ids, `Entitlements`, `UsageSink` | [architecture.md](../../docs/architecture.md#extension-points) |

## What does not

Network calls, SQL, file access, environment variables, logging setup, HTTP types. Those live in adapters that implement the ports defined here.

## Usage

```ts
import { /* named exports */ } from "@skillcdn/core";
```

Everything public is exported from `src/index.ts`. There are no deep imports.
