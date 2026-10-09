<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/indexer</h1>
<p align="center">The reading rules of SkillCDN: a commit or a working tree read into an index, and what an agent would get from it.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/indexer"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/indexer"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

The reading rules of [SkillCDN](https://skillcdn.ai) as code: how a commit becomes an index, and what an agent gets from it. The server indexes every commit with this package, and the `skillcdn check` command ([`@skillcdn/cli`](https://www.npmjs.com/package/@skillcdn/cli)) reads a working tree with the same code, so a repository that passes `check` is served as `check` showed it ([ADR-0045](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0045-the-indexer-is-a-package-and-check-is-a-command.md)).

Node.js only: it hashes bytes and, for `checkDirectory`, reads a directory. No network, no database, no environment of its own: the git host, the blob store and the limits are passed in. Nothing from a repository is executed, and symbolic links are never followed.

## What it exports

| Export | What it does |
|---|---|
| `buildSnapshotIndex(options)` | Reads one commit through the reading side of the git-host port into a `SnapshotIndex`: the served set, the searchable text, every skill with its digest, the license, and the diagnostics for the author. Partial under the limits, never failing because of them. |
| `INDEX_VERSION` | The version of the reading rules. A commit indexed under an older one is rebuilt when it is next asked for. It is bumped whenever a change would make the index of a commit come out differently. |
| `checkDirectory(options)` | Reads a working tree as `buildSnapshotIndex` reads a commit, through an in-memory git host, and writes the report of what an agent would get, headed by `INDEX_VERSION`. Returns the exit code: `0` without index diagnostics, `1` with, `2` when the directory cannot be read ([ADR-0020](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0020-a-check-role-reads-a-working-tree-with-the-indexer.md)). |
| `INDEX_LIMIT_DEFAULTS`, `INDEX_LIMIT_VARIABLES`, `readIndexLimits(environment)` | The limits on the work one repository may cause, their defaults, and the `INDEX_*` variables they are read from, each with the range it allows. `readIndexLimits` takes any record of strings and names the variable and the rule when one cannot be read, never the value. |
| `gitBlobHash(bytes)`, `sha256Hex(bytes)` | The hash git gives a file with this content, and the digest the MCP skills extension declares for served bytes. |

The types of an index (`IndexEntry`, `SnapshotIndex`, `SkillFrontMatter`, `SnapshotDiagnostic`, `StoredTranslation`) are defined in [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core), which the database package shares with this one.

## Tests

`build-index.test.ts` verifies publication through skill declarations, document directories and bounded local Markdown links, including hidden paths and manifest boundaries kept when reads or limits fail; linked reference files are readable without becoming search results. `check.test.ts` covers what a working tree has and a git tree does not: hidden skill roots, `.git`, `node_modules` and symbolic links. `limits.test.ts` covers the variables.

## Status

Pre-1.0: the surface may change between minor versions, and the changelog says what changed. The convention it implements is specified in [skill-repo.md](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/skill-repo.md).
