<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/client</h1>
<p align="center">The REST API of a SkillCDN deployment as typed functions: what a program reads a pack with, in Node.js and in a browser.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/client"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/client"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

A client of the [REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) of a [SkillCDN](https://skillcdn.ai) deployment: one function per route, every answer parsed with the schemas of [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core), which the server is tested against, and every failure an `ApiError` with the code the API gave it. The web UI of a deployment reads through it at its own origin, the `skillcdn` command reads a deployment's pack through it, and a program of yours, a console, a job, an agent's own tool, does the same ([ADR-0056](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md)).

```ts
import { createClient, skillPages, whenIndexed } from "@skillcdn/client";
import { parseAddress, skillResultOf, mountSummaryOf, joinSkillPages, renderSkillResult } from "@skillcdn/core";

const client = createClient({ baseUrl: "https://skillcdn.ai", token: process.env.SKILLCDN_TOKEN });
const address = parseAddress("/gh/skillcdn/skills");
if (address.ok) {
  const mount = await whenIndexed(client, address.value);          // waits while a first look indexes the commit
  const summary = mountSummaryOf(mount);
  const pages = await skillPages(client, address.value, "engineering/writing-a-pack/SKILL.md");
  const skill = joinSkillPages(pages.flatMap((page) => skillResultOf(page, summary) ?? []));
  if (skill) console.log(renderSkillResult(skill));                // the text an MCP client's model is given
}
```

## What it exports

| Export | What it does |
|---|---|
| `createClient(options)` | A `SkillCdnClient` at `baseUrl`: `mount`, `browse`, `find`, `skill` and `file` read an address, with the `token` of the deployment as the bearer of each request where one is given (an access token or a repository token, [permissions](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/permissions.md)); `featured`, `showcase`, `legal` and `owner` read what a deployment shows everyone, and `search(query, limit)` searches across every pack it serves; `me` and the rest under it belong to whoever is signed in on the deployment's own pages, by their session, which a browser sends. `fetch`, `userAgent`, `timeoutMs` and `maxBodyBytes` are optional. A redirect is never followed. |
| `ApiError` | What went wrong: the HTTP `status` (`0` for no answer), the `code` the API gave (`mount.repo_not_found`, `auth.invalid_token`, `skill.not_found`, `file.too_large`, ...; `network` and `invalid_response` are the client's own), and what came with it: `directories`, `sourceUrl`, `retryAfterSeconds`. |
| `whenIndexed(client, address, options)` | The `mounts` answer once the index is ready, asking again while a first look at a commit indexes it; `index.failed` and `index.indexing` are `ApiError`s. |
| `skillPages(client, address, path, options)` | Every page of a skill's context, read with the cursor each gives, until the skill is complete. `joinSkillPages` of `@skillcdn/core` makes one skill of them. |

The bodies are the shapes of `@skillcdn/core` (`RestMount`, `RestBrowse`, `RestFind`, `RestSkill`, `RestFile`, ...), which its `mountSummaryOf`, `catalogStateOf`, `browseResultOf`, `findResultOf`, `skillResultOf` and `fileResultOf` read back as the results the renderers write the text a model is given from.

Node.js 24 or a browser with `fetch`, `AbortSignal.any` and `AbortSignal.timeout`.
