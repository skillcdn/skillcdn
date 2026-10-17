# ADR-0053: An address may name a pack served from a machine

- Status: Accepted
- Date: 2026-10-18
- Builds on [ADR-0020](0020-a-check-role-reads-a-working-tree-with-the-indexer.md) and [ADR-0045](0045-the-indexer-is-a-package-and-check-is-a-command.md). The grammar is in [specs/address.md](../specs/address.md#served-from-a-machine).

## Context

Everything an agent gets from SkillCDN comes from a deployment: a server next to PostgreSQL, reading a git host. An agent on a machine where no deployment is reachable, offline, or in a network that reaches no git host, gets nothing, although the pack is a directory on its disk and the reading rules run anywhere (`skillcdn check` reads a working tree with them, [ADR-0045](0045-the-indexer-is-a-package-and-check-is-a-command.md)). The `skillcdn` command is to serve such a directory as a deployment would serve the repository: the same reads for an agent with a shell, and MCP and REST on the machine for everything else. A served directory needs an address, since every result, cursor and skill URI names one, and the grammar names a git host first.

## Decision

1. **`local` is a host of the address grammar.** `/local/<owner>/<name>[/<path>]` names a pack served from a machine by the command, with no git host behind it. It keeps the three segments of every address, so that every parser, path and URI treats it as one; the `<owner>/<name>` are what the command was told to call the directory, else the directory's parent's name and its own; letters, digits, `.`, `_` and `-`, kept as written, since file systems differ on case. A ref is not served: a working tree is what it is, and `@<ref>` parses and is not found.
2. **A deployment serves no `local` address.** To MCP, the REST API and the pages it is a name that is nothing, in the same words and after the same work; the operator's lists refuse it. `GIT_HOST_KEYS` stays the git hosts, `Address.host` widens to them and `local`, and what needs a git host narrows with `isGitHostAddress`.
3. **A local mount is verified.** The person chose the directory: its content is served in full under its license, with no provenance notice, as `check` reports it.
4. **What the command answers from a directory is what a deployment would answer from the same commit**, by the same reading rules and the same words for a model. The one allowed difference is the order of search results: the words that match are the same, and which comes first may differ between an index searched in memory and one searched by PostgreSQL ([tools](../specs/tools.md)).

## Consequences

- The grammar gains a host with no adapter behind it, and the key is reserved for this use: no git host will be called `local`.
- A skill URI `skill://local/<owner>/<name>/<path>` names a file on one machine and means nothing elsewhere; a host that lists skills from such a server keys them to that server, as the extension does for any.
- An organization whose packs live where no deployment can read them, a closed network, a laptop without a connection, gets them through the command, from a directory it synchronizes by any means.
- The roadmap tracks what serves such addresses; this decision settles only what they are.
- Rejected: `gh/` for a directory that is not on GitHub (it lies about provenance, and a URI would collide with the real repository's); a one-segment `local/<name>` (a second shape for every parser, path and URI); a ref for a working tree (nothing to resolve it against); an unverified local mount (the provenance notice is for what someone else wrote, and the person chose the directory).
