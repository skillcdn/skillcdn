# ADR-0012: What a client is told on connect, and what it is offered

- Status: Accepted; points 1 to 3 are superseded by ADR-0022
- Date: 2026-09-22

## Context

A mounted address exposes three tools, however many skills the repository holds ([specs/tools.md](../specs/tools.md)). Until now a client learned nothing else: the instructions named the repository and the tools, so a model had to call `find` before it could tell whether the server mattered for the task at hand, and a person had no way to call a skill up by name. The protocol offers more than tools: server instructions and server info, prompts, resources, structured tool results. Clients differ in what they do with each, and in how much of it reaches the model.

## Decision

1. **The catalog travels with the connection.** The server instructions carry the repository, the commit and the mounted path, how many skills and other documents there are, every skill with its description, and how a skill is used. The description of `find` names the skills as well, for clients that show no instructions. The server info carries the address as its title and the page of the address as its website. The instructions stay under 2,000 characters, because clients hand them to the model as they are and one of them cuts them there: descriptions are shortened step by step, then only names are listed, then fewer names with a count.
2. **Skills are prompts as well.** Every skill is registered as an MCP prompt named after it; asking for it returns what `get` returns. Documents are not resources: `find` and `read_file` reach them, and a repository may hold hundreds of them.
3. **Results stay text.** A structured form next to the text can be added without breaking anyone, and nothing a client does today needs it.
4. **The endpoint answers browsers on any origin**, as the REST API does. The content is public, anonymous and read-only, and no cookies are involved. A private repository will be reached with a token the page sends on purpose, so the rule can stay.
5. **A connection is counted at `initialize`.** Clients of the 2026 protocol revision have no such step; they are counted as distinct clients per request ([ADR-0010](0010-distinct-clients-by-daily-keyed-hash.md)), which is the number the rankings use.

## Consequences

- Connecting costs one catalog query per snapshot and mounted path, cached in the process, and never waits for the index: a client that connects while a commit is being indexed reads instructions that say so and an empty list of prompts, until it connects again.
- The instructions are a budgeted text. A repository with many skills is listed by names alone, and beyond the listing cap by count; `find` without a query remains the complete listing.
- Rejected: one tool per skill (most clients load every tool into the context); documents as resources (hundreds of entries for little gain); waiting for the index during `initialize` (a connection must never hang on the git host).
