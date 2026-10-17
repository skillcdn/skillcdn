<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/reader</h1>
<p align="center">The reads of SkillCDN: what the MCP tools, the REST API and the <code>skillcdn</code> command answer from an index, wherever the index is kept.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/reader"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/reader"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

The reads of [SkillCDN](https://skillcdn.ai) as code: a folder browsed, a search, a skill assembled from its rules, body and included files and cut into pages, a file read by pages, and what the MCP skills extension lists and serves, each as the data the [tools](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md) and the [REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) answer with. The server answers every request with this package over the index it keeps in PostgreSQL; the `skillcdn` command answers from a directory with the same code over an index in memory, so that what a deployment answers and what the command answers from the same commit is the same ([ADR-0054](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0054-the-reads-are-a-package-over-an-index-store-port.md)).

Node.js only. No network, no database, no environment of its own: the index comes from the caller through the `IndexStore` port of [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core), and so does a body the store does not hold.

## What it exports

| Export | What it does |
|---|---|
| `Reader` | The reads over a mount: `catalog`, `overview`, `browse`, `find`, `skill`, `file`, and `listSkills`, `getSkill`, `readResource`, `readDirectory` for the skills extension. Each takes a `MountContext` and answers data, a result or why the index is not ready; the MCP tools and the REST bodies of `@skillcdn/core` are written from them. |
| `ReaderDependencies` | What a `Reader` is made with: the limits, `index(mount, waitMs)`, which answers the `ReadableIndex` of the mount's commit or that it is not ready yet, and `fetchBody`, for a body the store does not hold. |
| `MountContext` | What the reader needs to know of a mount: its address and commit, whether it is verified, its limits, how results name its repository, and where its files are at their source. A caller's own mount type extends it and travels through the reader untouched. |
| `ReaderInputError` | An input the caller can correct, with the code `request.invalid`: a path outside the mount, a cursor of another request, a page that cannot advance. |
| `BodyUnavailableError` | A body the index names is at hand nowhere. |
| `compareByteOrder` | The order the index keeps paths in. |

## Tests

The server's integration tests read fixture repositories through this package over PostgreSQL; the command's tests read the same fixtures over an index in memory.
