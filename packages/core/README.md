# @skillcdn/core

Pure domain logic. No I/O, no Node.js APIs, no workspace dependencies: it runs unchanged in the server, in tests and in a browser.

**Status:** the address scheme, the skill-repo convention, the tool contracts and the ports for milestone 1 are implemented ([roadmap](../../docs/roadmap.md)).

## What belongs here

| Area | Spec |
|---|---|
| Address parser and formatter | [specs/address.md](../../docs/specs/address.md) |
| Skill-repo convention parser (front-matter, layouts, manifests) | [specs/skill-repo.md](../../docs/specs/skill-repo.md) |
| Tool contracts: names, input and output schemas | [specs/tools.md](../../docs/specs/tools.md) |
| Permission rules: the decision logic, given facts fetched elsewhere | [specs/permissions.md](../../docs/specs/permissions.md) |
| REST contracts: the schemas of the public API, and of what a signed-in person has (`rest/account.ts`) | [specs/rest.md](../../docs/specs/rest.md) |
| Ports: git host (`GitHost` for content, `GitHostLogin` for signing in and what a person can see, `GitHostDirectory` for an account's public listing, `GitHostEventSource` for what the host says happened, as the events that end what is remembered), blob store, clock and ids, `Entitlements`, `UsageSink` | [architecture.md](../../docs/architecture.md#extension-points) |

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

For the MCP skills extension: `skillDocumentInput` and `assembleSkillDocument` turn a skill's sources into the one document it is served as, so that the indexer's digest and the reader's bytes agree; `renderSkillSections` gives the tools the same sections; `skillListingProblem` says why a skill cannot be listed; `formatSkillUri` and `parseSkillUri` implement the URI grammar; `decodeText` is the one UTF-8 decoder every adapter uses.

`parseOwnerPath` and `formatOwnerPath` read and write `/gh/<owner>`, the path of the page of an account, with the owner rules of the address grammar. `rest/account.ts` also holds the paths the pages and the server share for signing in (`AUTH_ROUTES`, `loginPath`, and `SIGN_IN_PARAM` with `signInPath`, by which the server asks a page to open the sign-in dialog and tells it why a sign-in did not complete), the account pages and the consent page, so that neither side spells them on its own.

Everything public is exported from `src/index.ts`. There are no deep imports.
