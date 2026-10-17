# ADR-0057: A directory is served by the command over stdio and HTTP, through the edges as a package

- Status: Accepted
- Date: 2026-10-18
- Builds on [ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md), [ADR-0054](0054-the-reads-are-a-package-over-an-index-store-port.md) and [ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md).

## Context

The command reads a directory as a deployment reads a repository ([ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md)), for an agent with a shell. An agent without one, an app that speaks MCP, and a console on a closed network that reads packs through the REST API, need the directory served: the tools, the prompt and the skills extension at an address, and the routes of the REST API. All of that lived in `apps/server`, written against the deployment's `Mount`, its statistics and its logger.

## Decision

1. **`packages/serve` (`@skillcdn/serve`) is the edges as a library:** `createMountServer` makes the MCP server of a mount, the four tools, the prompt and the skills extension over a reader, with what a deployment counts of their use as optional hooks; `registerAddressRoutes` puts the five routes that read an address on any Hono app, with the app's own way of saying who a request is for; the replies, the error bodies and the failure mapping are the package's. A `ServedMount` is a `MountContext` with what the edges need besides the reads: until when a client may keep what it reads, and whose the answers are. The server composes the package with its mounts, its hooks and its logger, and nothing an agent gets changes.
2. **The command serves a directory with the same package.** `skillcdn mcp <directory>` serves one mount to the client at the other end of standard input and output, which every agent that speaks MCP starts as a process; `skillcdn serve <directory>...` serves one or several at their addresses over HTTP on this machine, with the REST routes beside them and a listing at the root, so that a console or any program reads them as it reads a deployment. A directory is read again when its files change.
3. **What is served from a machine is one machine's own:** no authorization, since the person chose the directories; cache fields that say to keep nothing (`ttlMs` zero, `cacheScope` private), since a working tree changes without a commit; verified, as [ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md) says; a ref or a path an address names that the directory was not given is nothing.
4. **Dependency edges:** `serve → core, reader`, with Hono and the MCP SDK; `server → db, github, indexer, reader, serve`; `cli → core, indexer, reader, client, serve`. The versions the server and the package share are in the catalog.

## Consequences

- An organization whose packs reach no deployment serves them from a machine with the command alone: its agents connect to the addresses as they would to a deployment, and its console reads them through the same REST API.
- The MCP surface has one implementation, tested through the server against PostgreSQL and through the package against an index in memory.
- The command's HTTP server listens on the loopback unless told otherwise, and has no sign-in: on a shared network it is for whoever can reach it, which the person who binds it to an interface decides.
- Rejected: a second MCP server for the command (two surfaces to keep in step); HTTP only (an agent that starts MCP servers as processes could not use it without a port); a page of the command's own beyond the listing (the deployment's pages show what a deployment serves, from a database it has).
