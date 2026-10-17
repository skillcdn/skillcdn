# ADR-0055: The command reads a pack as a deployment serves it, from a directory first

- Status: Accepted
- Date: 2026-10-18
- Builds on [ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md) and [ADR-0054](0054-the-reads-are-a-package-over-an-index-store-port.md). The command is specified in [the cli package's README](../../packages/cli/README.md); what it answers is [what an agent gets over MCP](../specs/tools.md).

## Context

An agent that has a shell but no MCP connection, that must not carry one more server in its context, or that runs where no deployment is reachable, has had no way to the skills of a pack. The reads are a package now ([ADR-0054](0054-the-reads-are-a-package-over-an-index-store-port.md)), the reading rules read a directory ([ADR-0045](0045-the-indexer-is-a-package-and-check-is-a-command.md)), and the words a model is given are rendered in `core`: everything the `skillcdn` command needs to answer what an MCP client's model is given exists, and the question is only what the command says and how.

## Decision

1. **The command has the four reads of MCP and the connection, as five commands:** `skillcdn skills <pack>` (the connection instructions, then every skill and document), `browse`, `find`, `skill` and `file`, each printing the text the matching tool gives a model, rendered by the same functions, with the reads named as the commands (`skillcdn browse` where a tool result says `browse_repo`), or the JSON of the matching REST route with `--json`. A skill is printed whole: its pages joined, the rules first.
2. **A pack is a directory on this machine first.** The directory is read as the indexer reads a commit, kept as an index in memory (`createMemoryIndex` of `@skillcdn/reader`) and read by the same reader a deployment reads with, as a verified mount at `local/<its parent>/<its name>` or what `--as` says ([ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md)). A deployment's address is the next source, through a client of the REST API, and the commands do not change for it.
3. **What the command answers from a directory is what a deployment answers from the same commit.** An integration test of the server reads the fixture repositories through both, the index in memory and the index in PostgreSQL, and holds every result equal: folders, listings, skills page by page, files; and a search's results the same, in the same order where the ranks decide it.
4. **The command's words are the tools' words.** The renderers of `core` take the names of the reads (`ToolWords`); the MCP endpoint keeps the tool names, the command says its commands, and nothing else of the text differs. An agent that learned one reads the other.
5. **Exit codes say what happened:** `0` done, `1` the pack does not have it, `2` the directory cannot be read, `64` a usage error, `78` a limit variable that cannot be read, `70` a failure; `check` keeps its `0`, `1` and `2`.
6. **Dependency edges:** `cli → core, indexer, reader`. The command stays thin: arguments, output and exit codes; the reads are the reader's and the words are core's.

## Consequences

- An agent with the package installed reads a pack from a directory with no server, no database, no network and no configuration beyond the directory: the air-gapped case ([ADR-0053](0053-an-address-may-name-a-pack-served-from-a-machine.md)) is met for the reads.
- The whole skill arrives in one answer where MCP pages it, which a shell carries and a model's context pays for as it would for the pages.
- `check` reads a directory through the same `readDirectory` the command serves it from: one walker, one in-memory host.
- Rejected: words of the command's own for each result (a second rendering to keep in step with the tools'); a `--page` flag for a skill (an agent wants the skill, and the page bound is the MCP response budget's, not the shell's); naming the directory `gh/<owner>/<repo>` (ADR-0053).
