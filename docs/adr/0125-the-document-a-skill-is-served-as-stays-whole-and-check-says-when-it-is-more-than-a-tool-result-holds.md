# ADR-0125: The document a skill is served as stays whole, and `check` says when it is more than a tool result holds

- Status: Accepted
- Date: 2026-11-23
- Builds on [ADR-0025](0025-a-skill-on-the-wire-is-assembled-from-its-sources.md) (the document), [ADR-0044](0044-a-skill-may-include-a-page-of-a-shared-document-set.md) (shared pages) and [ADR-0124](0124-what-reaches-an-agent-is-bounded-in-bytes-on-either-route-and-a-part-says-what-a-page-says.md) (the bound of a tool result). It changes none of them.

## Context

A skill reaches an agent by two routes. The tools give its context in pages of 16 KiB, each inside a tool result of 24 KiB at most, so that a client gives its model a page whole ([ADR-0123](0123-a-page-of-a-skill-counts-its-reach-in-bytes-and-keeps-whole-a-line-that-fits-a-page.md), ADR-0124). The skills extension hands a host one `SKILL.md`, assembled from the rules above the skill, its instructions and every file it includes (ADR-0025, ADR-0044). That document has no pages: it is as long as the skill.

Of the 33 skills of the reference pack (2026-11-23), 28 are served as a document of more than 24 KiB, seven as one of more than 48,000 bytes, and the longest as 61,510. One client was run reading such a document in one piece, with its own tool for a resource: its model was given the head and the tail, with 14 KB cut from the middle, and went on to read the pages ([the tools](../specs/tools.md#results-and-continuations)). `skillcdn check` printed the size of the document, `extension: listed, 61390 bytes as served`, and nothing of what the size means on that route; neither did the guide.

Two changes were proposed. That the document carry included files up to a bound and name the rest by path, to be read before the skill is used. And that `check` compare the size of the document with the bounds of the hosts.

No host that implements the skills extension has been run with a long document. The bounds that are known are of other things:

- what a client gives its model of one tool result, a resource read among them, which runs among the clients read from 8,000 characters to some 100,000, and in the one that was run from 12,000 bytes to 48,000 with the model ([the tools](../specs/tools.md#results-and-continuations), ADR-0124);
- what a `SKILL.md` is recommended to hold by the Agent Skills specification, under 5,000 tokens and 500 lines, and the first 5,000 tokens of a skill of its own that Claude Code keeps once it has shortened a conversation (its documentation, read 2026-11-23, not run). Both are of the order of the 16 KiB of instructions and included files a skill aims at here, which `check` compares with already (`skill_large`).

## Decision

1. **The document goes on carrying every included file whole.** Nothing of ADR-0025 and ADR-0044 changes: the tools and the extension serve the same text, and a skill arrives complete on both.
2. **`check` compares the document with this server's own bound, a tool result's.** Under a listed skill whose document is more than `MCP_RESULT_MAX_BYTES`, the `extension:` line says so: `extension: listed, 61390 bytes as served, in one piece: over the 24576 bytes a tool result is kept within`. A note, `served_large`, counts such skills among the listed, and says that a host is handed the document in one piece and what the document holds. It fails nothing.
3. **No client's bound is in the code or in the report.** What the clients measured do with a long read stays in the specification, with the client's version and the day it was seen. The report prints the size of every document, for whoever compares it with one of them.
4. **Whether the document is bounded is an open question of the format** ([the format](../specs/skill-repo.md#open-questions)), decided on runs with hosts that implement the extension.

## Consequences

- An author sees before a push which skills a host of the extension is handed in one long piece, and the guide says what an included file costs on that route.
- The rules above a skill count here, as they are in the document, and do not count in what a skill aims at. In the reference pack the new note names the 28 skills `skill_large` names, since its rules and a skill's front matter come to about the 8 KiB between the two bounds. A pack with longer rules has skills this note names alone; one with shorter rules has fewer of them than of large skills.
- The report gains a note and a longer line. Its exit code, the index and the reading rules do not change.
- Rejected:
  - a table of the hosts' bounds in `check`: none is of a host that implements the extension, and each changes with the client's version and its model, so a command would go on reporting what was so when it was built, in an image as from `@latest`;
  - the 48,000 bytes of the one client run, as the bound compared with: it is that client's for the models it ships with, and a quarter of it for a model it does not know;
  - a comparison with the 5,000 tokens recommended for a `SKILL.md`: `skill_large` makes it, in bytes;
  - bounding what the document carries, as proposed: a file left out would be named by a path for the host to read, and a shared page is not among a skill's resources (ADR-0044), which is about half of what the skills of the reference pack include, by bytes; the tools would carry another text than the extension, against ADR-0025, or name by path what they carry today; and a host that does not read on would hold a skill without what every run needs, where it now holds all of it or a document its client cut. Every digest would change once;
  - a larger page for the tools: nothing was measured since [ADR-0123](0123-a-page-of-a-skill-counts-its-reach-in-bytes-and-keeps-whole-a-line-that-fits-a-page.md) rejected it.
