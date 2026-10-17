<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/serve</h1>
<p align="center">The edges of SkillCDN as a library: the MCP tools and the skills extension, and the REST routes of an address, over a reader; served over stdio or HTTP from any index.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/serve"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/serve"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-3a6dd4"></a>
</p>

What a [SkillCDN](https://skillcdn.ai) address serves, as code that serves it anywhere: the four tools, the prompt and the MCP skills extension of [the MCP surface](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/tools.md), and the five routes of [the REST API](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md) that read an address, over the reader of [`@skillcdn/reader`](https://www.npmjs.com/package/@skillcdn/reader). The server of a deployment composes it with its own mounts, its sign-in and its statistics; the `skillcdn` command serves a directory with it, over stdio to one agent or over HTTP to any ([ADR-0057](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0057-a-directory-is-served-by-the-command-over-stdio-and-http.md)).

## What it exports

| Export | What it does |
|---|---|
| `createMountServer(mount, dependencies, request)` | The MCP server of one mount: `browse_repo`, `search_repo`, `load_skill`, `read_repo_file`, the `use_skill` prompt, and `skills/list`, `skills/get`, `resources/read`, `resources/directory/read` and `resources/list` of the skills extension, over `dependencies.reader`. `hooks` receive what a deployment counts; `request.origin` names where the server's page and icon are. One instance per connection or request. |
| `registerAddressRoutes(app, dependencies)` | The `mounts`, `browse`, `find`, `skills` and `files` routes on a Hono app, with CORS for any origin and no caching; `mountAt` says who a request is for and `mountBody` what names the address. |
| `createLocalApp(options)`, `listenOn(app, { host, port })` | The HTTP app of a machine's own: MCP at each mount's address, the address routes, and a listing at `/`; and a listener on a host and a port. |
| `serveOverStdio(mount, options)` | One mount served to the client at the other end of standard input and output. |
| `ServedMount` | A `MountContext` with what the edges need besides the reads: `trustedUntil` and `visibility`. |
| `localMountBody`, `mountOf`, `errorBody`, `hostFailure`, the replies | What the pieces above are made of, for an app that composes them its own way. |

Node.js 24 or newer. Nothing here signs anyone in or keeps anything: who may read an address, and what is counted, is the composing app's.
