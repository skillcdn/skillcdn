# @skillcdn/core

Pure domain logic. No I/O, no Node.js APIs, no workspace dependencies: it runs unchanged in the server, in tests and in a browser.

**Status:** the address scheme, the skill-repo convention, the tool contracts and the ports for milestone 1 are implemented ([roadmap](../../docs/roadmap.md)).

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

`extractMarkdownReferences(sourcePath, markdown)` recognizes local `.md` links in prose and resolves them to repository-root paths. It ignores code and external URLs and bounds input size and reference count. `resolveMarkdownReference` exposes the same path resolution for a single destination. These helpers identify references; the indexer decides whether their destinations may be served.

`inspectMarkdownReferences` also reports when those inspection bounds are reached. `browseCatalogFiles` builds immediate folder entries and descendant counts from already published files; both the server and the working-tree check use it.

`isServedPath` combines skill declarations, the nearest repository manifest's document directories, and explicit includes. A valid `SKILL.md` can declare a skill anywhere, including a hidden directory. A declaration permits ordinary descendants; further hidden descendants need their own declaration or a Markdown link.

Ancestor `exclude` paths and unreadable manifest scopes take precedence over publication. `selectReadmePaths` and `folderOverview` supply optional original-language introductions without loading their bodies or adding search results. MCP discovery summaries and serialized response budgets keep selection separate from full context loading; REST retains full metadata.

Everything public is exported from `src/index.ts`. There are no deep imports.
