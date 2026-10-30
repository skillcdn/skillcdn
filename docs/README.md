# Documentation

How the docs are organized, and what each one is for. The rules for *when* to update them are in the root [`CLAUDE.md`](../CLAUDE.md) under "Documentation protocol".

| Document | Purpose | Lifecycle |
|---|---|---|
| [`../README.md`](../README.md) | What SkillCDN is, for someone who has never seen it. | Overview only. Details live below. |
| [`../SKILLCDN.md`](../SKILLCDN.md) | This repository as a pack, served at `skillcdn.ai/gh/skillcdn/skillcdn` ([the manifest](specs/skill-repo.md#the-repository-manifest-skillcdnmd)): the name and description an agent is told on connect, that `docs/` is what it serves, and the rule for reading it. | Living. |
| [`architecture.md`](architecture.md) | How the system is built: components, boundaries, data, stack, security model, extension points. | Living. Always describes the intended current design. |
| [`roadmap.md`](roadmap.md) | What exists, what is being built now, what comes next. | Living. Updated when a milestone item starts, finishes or is dropped. |
| [`specs/`](specs/) | The public contract: address scheme, the SkillCDN Format (what a pack is, how it is read and written), tools, REST API, people and private repositories. | Living and normative. If the README and a spec disagree, the spec wins and the README gets fixed. |
| [`guide/`](guide/) | User documentation: how to use a pack from an AI app, and how to write one. For the authors of packs and the people who use them; links to the specs for the rules instead of restating them. | Living. |
| [`nav.json`](nav.json) | Which files the pages of a deployment publish under `/docs`, in which sections and order, with an optional slug, title and description each ([ADR-0049](adr/0049-the-documentation-is-rendered-into-the-pages-from-the-repositorys-own-files.md)). A file that is not listed is not published. The build fails on a link that leads nowhere. | Living. |
| [`adr/`](adr/) | Decisions with lasting consequences, and why. | Append-only. Accepted ADRs are superseded, never edited. |
| [`../deploy/README.md`](../deploy/README.md) | Building, configuring and releasing the image; the contract with the infrastructure that runs it. | Living. |
| `<workspace>/README.md` | What a package is for, its public surface, how to work on it. | Living. |
| `CLAUDE.md` (root and per directory) | Rules for changing the code, for agents and humans. | Living. Short. |
| [`../apps/web/connect-guide.md`](../apps/web/connect-guide.md) | What the connection guide on the page of a repository shows for each client, and the sources it was checked against. | Living. The clients' menus change on their own; recheck the sources when the steps change. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../SECURITY.md`](../SECURITY.md) | How to contribute, and how to report a vulnerability. | Living. |
| [`../AGENTS.md`](../AGENTS.md) | Points an agent at `CLAUDE.md`, and nothing else. | Fixed. |
| `packages/<name>/CHANGELOG.md` | What each release of a published package changed, from the changesets, for whoever installs it. | Written by the release workflow, never by hand. |

## Principles

- **Write for a reader with no context.** The next contributor, human or agent, starts from the repository alone.
- **Facts and decisions, not history or essays.** Git history is the changelog.
- **One home per fact.** Link instead of repeating.
- **This repository is public.** Operations details, business reasoning and comparisons with other products do not belong here.
