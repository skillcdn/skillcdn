<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/core</h1>
<p align="center">The contracts of SkillCDN: the address scheme, the skill-repo convention, tool and REST schemas, the types of an index, and the ports.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/core"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/core"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

[SkillCDN](https://skillcdn.ai) turns any git repository into an MCP server. This package is its contracts: the address scheme, the skill-repo convention, the tool contracts, the REST schemas, the types of an index, and the ports the rest of the system implements. Pure TypeScript with no I/O and no Node.js APIs: it runs unchanged in the server, in tests, in a browser, and in whatever else reads or writes a SkillCDN address.

```sh
npm install @skillcdn/core
```

## What belongs here

| Area | Spec |
|---|---|
| Address parser and formatter | [address.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/address.md) |
| Skill-repo convention parser (front-matter, layouts, manifests) | [skill-repo.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md) |
| Tool contracts: names, input and output schemas | [tools.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md) |
| Permission rules: the decision logic, given facts fetched elsewhere | [permissions.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/permissions.md) |
| REST contracts: the schemas of the public API, and of what a signed-in person has (`rest/account.ts`) | [rest.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) |
| The types of an index: what the reading rules produce for a commit and what the store keeps (`IndexEntry`, `SnapshotIndex`, `SkillFrontMatter`, `SnapshotDiagnostic`, `StoredTranslation`) | [ADR-0045](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0045-the-indexer-is-a-package-and-check-is-a-command.md) |
| Ports: git host (`GitHost` for content, `GitHostLogin` for signing in and what a person can see, `GitHostDirectory` for an account's public listing, `GitHostEventSource` for what the host says happened, as the events that end what is remembered), blob store, clock and ids, `Entitlements`, `UsageSink` | [architecture.md](https://github.com/skillcdn/skillcdn/blob/main/docs/architecture.md#extension-points) |
| The mark of the site as path data, so that the pages, the favicon and the social previews the server draws show one shape | [apps/web/README.md](https://github.com/skillcdn/skillcdn/blob/main/apps/web/README.md) |

## What does not

Network calls, SQL, file access, environment variables, logging setup, HTTP types. Those live in adapters that implement the ports defined here. The reading rules that turn a commit into an index are [`@skillcdn/indexer`](https://www.npmjs.com/package/@skillcdn/indexer).

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

`isSharedIncludePath` says whether a skill may include a document from outside its directory: a page served under a document directory that a manifest at or above the skill declares ([ADR-0044](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0044-a-skill-may-include-a-page-of-a-shared-document-set.md)). `resolveRepoPath` resolves a path written as a link destination is, from the repository root with a leading `/` or relative to a directory; links and include lists share it.

Ancestor `exclude` paths and unreadable manifest scopes take precedence over publication. `selectReadmePaths` and `folderOverview` supply optional original-language introductions without loading their bodies or adding search results. MCP discovery summaries and serialized response budgets keep selection separate from full context loading; REST retains full metadata.

For the MCP skills extension: `skillDocumentInput` and `assembleSkillDocument` turn a skill's sources into the one document it is served as, so that the indexer's digest and the reader's bytes agree; `renderSkillSections` gives the tools the same sections; `skillListingProblem` says why a skill cannot be listed; `formatSkillUri` and `parseSkillUri` implement the URI grammar; `decodeText` is the one UTF-8 decoder every adapter uses.

`parseOwnerPath` and `formatOwnerPath` read and write `/gh/<owner>`, the path of the page of an account, with the owner rules of the address grammar. `rest/account.ts` also holds the paths the pages and the server share for signing in (`AUTH_ROUTES`, `loginPath`, and `SIGN_IN_PARAM` with `signInPath`, by which the server asks a page to open the sign-in dialog and tells it why a sign-in did not complete), the account pages and the consent page, so that neither side spells them on its own.

Everything public is exported from `src/index.ts`. There are no deep imports.

## Status

Pre-1.0: the surface may change between minor versions, and the changelog says what changed. The specifications linked above describe the contracts; the code follows them.
