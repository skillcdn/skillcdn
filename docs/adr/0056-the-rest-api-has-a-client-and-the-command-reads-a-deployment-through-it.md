# ADR-0056: The REST API has a published client, and the command reads a deployment through it

- Status: Accepted; the rejection of a sign-in of the command's own, and the one token per deployment of point 4, are superseded by [ADR-0059](0059-the-command-connects-with-a-code-a-person-approves.md)
- Date: 2026-10-18
- Builds on [ADR-0052](0052-the-rest-api-takes-the-tokens-the-mcp-endpoint-takes.md) and [ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md).

## Context

Three programs read the REST API with code of their own: the web UI of a deployment, the reference console, and now the `skillcdn` command. Each parses answers with the schemas of `core`, maps error bodies, sends a token as a bearer and must never follow a redirect with it; the console wrote all of that once more outside this repository ([ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)). The reads of the command ([ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md)) are to answer from a deployment as they answer from a directory, with the same words.

## Decision

1. **`packages/client` (`@skillcdn/client`) is the client of the REST API:** one typed function per route, every answer parsed with the schemas of `core`, every failure an `ApiError` with the API's code; a bearer token sent to `baseUrl` only, with no redirect followed; a timeout and a body bound on every request. It runs in Node.js and in a browser, and is published like the other packages ([ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md)). `whenIndexed` and `skillPages` read what takes more than one request.
2. **The web UI reads through it** at its own origin, and `apps/web` may import `client` beside `core` and `brand`.
3. **The command reads a deployment through it.** A pack named by an address (`gh/<owner>/<repo>[@ref][/path]`, a URL of a deployment, or a `skill://` URI) is read at the deployment of `--url`, else `SKILLCDN_URL`, else what the directory is bound to, else `https://skillcdn.ai`; the bodies are read back as results (`core`) and rendered with the same words as from a directory, and `--json` prints them as they came. A directory that exists is a directory; anything else is an address.
4. **A token goes only to the deployment it was made at.** `skillcdn login --url <origin> --token-stdin` keeps a token a person made, one per origin, in the person's configuration directory, readable by them alone where the system can say so; `logout` forgets it and `logins` names the origins and nothing else. `SKILLCDN_URL` and `SKILLCDN_TOKEN` are taken together or not at all, for a job. The command resolves the origin first and then the token for that origin, never the other way round.
5. **A directory may be bound to a pack.** `skillcdn use <address> [--url <origin>]` writes `.skillcdn.json` in the working directory, the address and where it is served, never a secret; a read without a pack argument in that directory or below reads the bound pack, so that one person binds a checkout and every agent in it reads the same pack.
6. **Dependency edges:** `client → core`; `cli → core, indexer, reader, client`; `web → core, brand, client`.

## Consequences

- One client of the API: the web UI, the command and whoever builds on the packages read the same way, and a change to the API is a change to one client with its changeset.
- An agent reads a private pack through the command with a repository token a person made once ([ADR-0040](0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md)); a public pack needs nothing.
- The command's directory file is one more file that names a pack: the pack's own `SKILLCDN.md` describes a pack, `.skillcdn.json` binds a checkout to one; they do not meet.
- Rejected: the client inside `core` (I/O, where `core` is pure); the command speaking MCP to a deployment (a second client of a protocol made for models, where the REST API serves the same); a sign-in of the command's own (a token of the deployment is made on its pages and is the credential every program holds, [ADR-0052](0052-the-rest-api-takes-the-tokens-the-mcp-endpoint-takes.md)); a token applied to any origin by default (it would leave for a server it was not made for).
