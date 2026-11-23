# Write skills

A skill is a set of instructions an agent follows to do one kind of work well, written as a directory with a `SKILL.md`. A pack of skills is a repository of such directories, with the rules they share and the documents they point to; what every pack shares, the manifest, the license, the check, publishing, is in [writing a pack](write-a-repository.md), and a repository may hold documents beside its skills, written as [writing documents](write-documents.md) says. The rules on this page are [the SkillCDN Format](../specs/skill-repo.md)'s, which is the reference; the reference pack, [skillcdn/skills](https://github.com/skillcdn/skills), is an example of them in use, with areas, shared pages and translations.

## The smallest pack

```
my-skills/
  skills/
    release-notes/
      SKILL.md
```

`SKILL.md` is YAML front-matter followed by Markdown:

```markdown
---
name: release-notes
description: Writes release notes from a list of merged changes, in the house style. Use when a release is about to go out and the changes are known.
---

# Release notes

Turns the merged changes of a release into notes a customer can read.

## Requirements

Access to the list of changes: the user pastes it, or the agent reads it from the repository.

## Workflow

1. Group the changes by what they mean to a customer: new, improved, fixed.
2. Write one line per change, in the present tense, without the ticket numbers.
3. Show the draft and ask what to cut.

## Rules

- Never invent a change that is not in the list.
- Keep the whole text under 300 words.
```

That is a complete, servable skill. The `name` repeats the directory's name, the `description` is what an agent reads to decide whether to load the skill, so it says what the skill does and when to use it in the words a user would say, and the body is what the agent follows; the rules for every field are in [the front-matter table](../specs/skill-repo.md#front-matter). Both `<area>/skills/<name>/` and `skills/<area>/<name>/` work, and a repository that is one skill puts its `SKILL.md` at the root.

## The body of a skill

An agent that has read one skill should know where to look in the next, so the format recommends one order for the body, from a summary through requirements, inputs and the workflow to the hard rules and the terms the skill uses ([recommended](../specs/skill-repo.md#recommended)); the skill above follows it in miniature. A skill that needs a file of the user's says so among its inputs; the agent reads the file from its own environment, since SkillCDN never receives files.

Keep the body to a few hundred lines: an agent receives a skill in pages, with the pack's rules in front of it, and the format says what size is a useful target. Nothing in a skill runs: a skill works from its `SKILL.md` and the documents it points to, and a script in the directory is help for an agent that works locally, served as text ([required](../specs/skill-repo.md#required)).

## Files beside the skill

Everything else in the skill's directory is a supporting file the body may point to:

```
skills/release-notes/
  SKILL.md
  references/style.md       what the body links to from the phase that needs it
  assets/example.json       small data the skill reads
  scripts/collect.sh        a helper for agents that run locally; served as text, never run
```

Link a file from the phase that reads it, with an ordinary Markdown link, and the agent reads it when the phase comes. A file that every run needs goes in `skillcdn.include` in the front-matter, so that it travels with the skill:

```yaml
skillcdn:
  include:
    - references/style.md
```

Only Markdown and small JSON are searched, and everything an agent must read is one or the other. A skill that points at a file that is not text, a model, an archive, a picture, points at something an agent can only fetch from the source, and `skillcdn check` says so; a page that explains the file in words is what the agent reads ([required](../specs/skill-repo.md#required)).

## Documents and shared rules

A pack can serve plain documents next to its skills: Markdown files under `docs/` are served as documents in their own right, and a skill can link to them. A page that several skills need on every run, what they all know about one tool for instance, lives once under `docs/` and is included by each skill with a root-relative path, `/docs/<tool>/models.md` ([shared pages](../specs/skill-repo.md#shared-pages)).

Rules that hold for every skill go in the manifest, `SKILLCDN.md`, whose body is delivered to the agent with every skill; a larger pack puts one folder per area of work, each with a manifest that says who its skills are for and adds the area's rules ([writing a pack](write-a-repository.md#the-manifest-and-the-shared-rules)). A shared `.md` reference outside the skill works through a repository-root connection; keep a skill self-contained when it must also work alone from a sub-path connection, and include the shared page every run needs, so that it travels with the skill.

## How a skill is served

An agent finds a skill by its description, through a search or a folder listing, and loads it by the exact path of its `SKILL.md`: the rules from the root down, then the instructions, then the included files, in pages until complete ([loading a skill](../specs/tools.md#loading-a-skill)). A host that implements the MCP skills extension receives the same skills as skills, assembled from these sources and digested as served ([what the extension serves](../specs/skill-repo.md#what-the-skills-extension-serves)): a skill is listed there when a host can hold it whole, which `skillcdn check` reports for each. Two skills with the same name in different folders stay distinct, and a copy of a skill under a hidden directory is loadable by its path and nothing else.

The two routes carry a long skill differently. Through the tools it arrives in pages, each small enough for a client to give its model whole. Through the skills extension it arrives as one document, with the rules above the skill and every included file in it, and a host that bounds what its model reads at once cuts a long one. So what a skill includes costs twice: pages to read on one route, and a document that may not arrive whole on the other. `skillcdn check` marks a skill whose document is over 24 KiB, what the tools keep one answer within, and counts such skills (`served_large`). The remedy is the one for a large skill: include what every run needs, and link the rest from the step that reads it ([what the extension serves](../specs/skill-repo.md#what-the-skills-extension-serves)).

A page ends between two blocks where it can: not inside a table or a fenced code block, and not right after a heading or a line that ends in a colon. A table or an example longer than 4 KiB, a quarter of a page, is cut all the same, a table after a row with its head said again on the next page, so a block an agent must read in one piece is kept shorter than that: some 4,000 characters of English, and some 1,300 where every character takes three bytes, as in Hangul. A line is never cut, unless it is longer than a page. Where the pages of a skill end depends on everything above them, the rules of the pack too, so `skillcdn check` says it: under each skill, every page that ends inside a table, a code block or a line, with the file and the line the next page begins at.

`skillcdn.translations` in the front-matter gives the page a title and a description in another language, for people; agents keep reading the original, and search matches the original words ([recommended](../specs/skill-repo.md#recommended)).

## Pointing at another pack

A skill that builds on a skill of another pack, or a page that would otherwise copy what another pack says, links to the file by its skill URI: `[the base skill](skill://gh/acme/skills/design/card/SKILL.md)`. Say in the sentence what the reader does with it, `load it first, then apply what differs below`. An agent that loads your skill is told which files it names in other packs and how each is read, and `skillcdn check --references` asks whether each is still there, so that a skill renamed in the other pack fails your check and not your user's task ([the format](../specs/skill-repo.md#markdown-references)). The other pack's file is not copied into yours: the agent reads it at its own pack, with that pack's rules.
