# Documentation

How the docs are organized, and what each one is for. The rules for *when* to update them are in the root [`CLAUDE.md`](../CLAUDE.md) under "Documentation protocol".

| Document | Purpose | Lifecycle |
|---|---|---|
| [`../README.md`](../README.md) | What SkillCDN is, for someone who has never seen it. | Overview only. Details live below. |
| [`architecture.md`](architecture.md) | How the system is built: components, boundaries, data, stack, security model, extension points. | Living. Always describes the intended current design. |
| [`roadmap.md`](roadmap.md) | What exists, what is being built now, what comes next. | Living. Updated when a milestone item starts, finishes or is dropped. |
| [`specs/`](specs/) | The public contract: address scheme, skill-repo convention, tools. | Living and normative. If the README and a spec disagree, the spec wins and the README gets fixed. |
| [`adr/`](adr/) | Decisions with lasting consequences, and why. | Append-only. Accepted ADRs are superseded, never edited. |
| [`../deploy/README.md`](../deploy/README.md) | Building, configuring and releasing the image; the contract with the infrastructure that runs it. | Living. |
| `<workspace>/README.md` | What a package is for, its public surface, how to work on it. | Living. |
| `CLAUDE.md` (root and per directory) | Rules for changing the code, for agents and humans. | Living. Short. |

## Principles

- **Write for a reader with no context.** The next contributor, human or agent, starts from the repository alone.
- **Facts and decisions, not history or essays.** Git history is the changelog.
- **One home per fact.** Link instead of repeating.
- **This repository is public.** Operations details, business reasoning and comparisons with other products do not belong here.
