# Documentation

How the docs are organized, and what each one is for. The rules for *when* to update them are in the root [`AGENTS.md`](../AGENTS.md) under "Documentation protocol".

| Document | Purpose | Lifecycle |
|---|---|---|
| [`../README.md`](../README.md) | What SkillCDN is and why to use it, for someone who has never seen it, with where the reference pack and the reference console fit. | Overview only. Details live below. |
| [`../SKILLCDN.md`](../SKILLCDN.md) | This repository as a pack, served at `skillcdn.ai/gh/skillcdn/skillcdn` ([the manifest](specs/skill-repo.md#the-repository-manifest-skillcdnmd)): the name and description an agent is told on connect, the page it is told to read first, which is this one, the folders it serves (`docs/`, and the two pages the site publishes from outside it, `deploy/README.md` and `packages/cli/README.md`, with the code and configuration beside them kept out), and the rule for reading it. | Living. |
| [`architecture.md`](architecture.md) | How the system is built: components, boundaries, data, stack, security model, extension points. | Living. Always describes the intended current design. |
| [`roadmap.md`](roadmap.md) | What exists, what is being built now, what comes next: an entry of one to three sentences each, linking the document that says the rest. | Living. Updated when an item starts, finishes or is dropped; its first section says how an entry is written, and nothing of history is kept there. |
| [`specs/`](specs/) | The public contract: [address scheme](specs/address.md), [the SkillCDN Format](specs/skill-repo.md) (what a pack is, how it is read and written), [tools](specs/tools.md), [REST API](specs/rest.md), [people and private repositories](specs/permissions.md). | Living and normative. If the README and a spec disagree, the spec wins and the README gets fixed. |
| [`guide/`](guide/) | User documentation: how to [use a pack from an AI app](guide/use-skills.md), and how to write one: [the pack](guide/write-a-repository.md), [its skills](guide/write-skills.md) and [its documents](guide/write-documents.md). For the authors of packs and the people who use them; links to the specs for the rules instead of restating them. | Living. |
| [`nav.json`](nav.json) | Which files the pages of a deployment publish under `/docs`, in which sections and order, with an optional slug, title and description each ([ADR-0049](adr/0049-the-documentation-is-rendered-into-the-pages-from-the-repositorys-own-files.md)). A file that is not listed is not published. The build fails on a link that leads nowhere. | Living. |
| [`adr/`](adr/) | Decisions with lasting consequences, and why. | Append-only. Accepted ADRs are superseded, never edited. |
| [`../deploy/README.md`](../deploy/README.md) | Building, configuring and releasing the image; the contract with the infrastructure that runs it. | Living. |
| [`../packages/cli/README.md`](../packages/cli/README.md) | The reference of the `skillcdn` command: checking a pack before pushing, reading one as an agent gets it over MCP, serving a directory to MCP clients. | Living. |
| `<workspace>/README.md` | What a package is for, its entry points and what each is for, how to work on it, and under "Rules" the rules for changing it. Not a list of every export: those are described where they are declared. | Living. |
| [`../AGENTS.md`](../AGENTS.md) | The working agreement: the rules for changing the code, for agents and humans. | Living. Short. |
| [`../apps/web/connect-guide.md`](../apps/web/connect-guide.md) | What the connection guide on the page of a repository shows for each client, and the sources it was checked against. | Living. The clients' menus change on their own; recheck the sources when the steps change. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../SECURITY.md`](../SECURITY.md) | How to contribute, and how to report a vulnerability. | Living. |
| [`../CLAUDE.md`](../CLAUDE.md) | Imports `AGENTS.md` for Claude Code, and holds nothing else; `.claude/rules/` points it at a workspace's rules when it opens a file there. | Fixed. |
| [`../TRADEMARKS.md`](../TRADEMARKS.md), [`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) | What the name and the marks may be used for, and the fonts, icons and other assets of others that ship in the image, each with its license. | Living. A bundled asset is listed in the notices in the change that adds it. |
| `packages/<name>/CHANGELOG.md`, `apps/web/CHANGELOG.md` | What each release of a published package changed, from the changesets, for whoever installs it. | Written by the release workflow, never by hand. |

## Principles

- **Write for a reader with no context.** The next contributor, human or agent, starts from the repository alone.
- **Facts and decisions, not history or essays.** Git history is the changelog.
- **One home per fact.** Link instead of repeating.
- **This repository is public.** Operations details, business reasoning and comparisons with other products do not belong here.
