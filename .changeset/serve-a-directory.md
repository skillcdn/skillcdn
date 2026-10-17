---
"@skillcdn/serve": minor
"@skillcdn/cli": minor
---

`@skillcdn/serve` is the edges of SkillCDN as a library (ADR-0057): `createMountServer` makes the MCP server of a mount, the four tools, the prompt and the skills extension over a reader, with what a deployment counts as optional hooks; `registerAddressRoutes` puts the five routes of the REST API that read an address on any Hono app; `createLocalApp`, `listenOn` and `serveOverStdio` serve mounts from a machine. The `skillcdn` command serves a directory with it: `skillcdn mcp <directory>` to the agent at the other end of standard input and output, and `skillcdn serve <directory>...` over HTTP on this machine, each directory at its `local/<owner>/<name>` address with the REST routes beside it, read again when its files change.
