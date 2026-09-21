# @skillcdn/core

Pure domain logic. No I/O, no Node.js APIs, no workspace dependencies: it runs unchanged in the server, in tests and in a browser.

**Status:** the address scheme is implemented; the rest arrives during milestone 1 ([roadmap](../../docs/roadmap.md)).

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
import { formatAddress, parseAddress } from "@skillcdn/core";

const parsed = parseAddress("/gh/acme/skills@v1.2.0/marketing");
if (parsed.ok) {
  parsed.value.ref; // { kind: "name", name: "v1.2.0" }
  formatAddress(parsed.value); // the canonical spelling
} else {
  parsed.error.code; // a stable, typed reason
}
```

Parsers return a `Result` and never throw. A `RepoPath` can only come from `parseRepoPath`, so a function that takes one does not need to think about traversal.

Everything public is exported from `src/index.ts`. There are no deep imports.
