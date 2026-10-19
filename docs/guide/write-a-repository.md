# Write a pack

A pack is a git repository with a `SKILL.md` for each skill, and the documents and rules beside them. Push it to GitHub, and its address serves the pack to any AI app that connects: `https://skillcdn.ai/gh/<owner>/<repo>`, or the same path on a deployment of your own. The layout is the [Agent Skills](https://agentskills.io/specification) layout, so a folder of skills that already works elsewhere works here unchanged; [the SkillCDN Format](../specs/skill-repo.md) is that layout plus a few conventions that make a pack useful to an agent, and it is the reference for every rule this page mentions.

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

That is a complete, servable skill. The `name` repeats the directory's name, the `description` is what an agent reads to decide whether to load the skill, so it says what the skill does and when to use it in the words a user would say, and the body is what the agent follows; the rules for every field are in [the front-matter table](../specs/skill-repo.md#front-matter).

Two things about YAML catch most authors: a colon followed by a space inside a plain value, and a space followed by a hash. Quote such a value, or write it as a block scalar, which takes any text ([writing the values](../specs/skill-repo.md#writing-the-values)):

```yaml
description: >
  Writes release notes from a list of merged changes: new, improved, fixed.
  Use when a release is about to go out.
```

## The body of a skill

An agent that has read one skill should know where to look in the next, so the format recommends one order for the body, from a summary through requirements, inputs and the workflow to the hard rules and the terms the skill uses ([recommended](../specs/skill-repo.md#recommended)); the skill above follows it in miniature.

Keep the body to a few hundred lines: an agent receives a skill in pages, with the pack's rules in front of it, and the format says what size is a useful target ([recommended](../specs/skill-repo.md#recommended)).

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

Only Markdown and small JSON are searched, and nothing in the repository is ever run, so a script is help for an agent that works locally, not something SkillCDN executes ([required](../specs/skill-repo.md#required)).

## Documents and shared rules

A pack can serve plain documents next to its skills: Markdown files under `docs/` are served as documents in their own right, and a skill can link to them. A page that several skills need on every run, what they all know about one tool for instance, lives once under `docs/` and is included by each skill with a root-relative path, `/docs/<tool>/models.md` ([shared pages](../specs/skill-repo.md#shared-pages)).

Rules that hold for every skill go in `SKILLCDN.md` at the repository root. Its front-matter names and describes the pack, and its body is delivered to the agent with every skill:

```markdown
---
name: Acme pack
description: The pack of Acme's marketing and product teams. Use to write, review and publish in the house style.
documents:
  - docs
license: MIT
---
# Rules for every skill in this pack

**One question at a time.** When a skill needs something it cannot derive, it asks for it in one short message, then goes on.

**Show before you publish.** Nothing leaves the conversation until the user has seen the draft.
```

A larger pack puts one folder per area of work, each with a `SKILLCDN.md` that says who its skills are for and adds the area's rules; connect the root for everything, or an area's folder for that area alone ([the repository manifest](../specs/skill-repo.md#the-repository-manifest-skillcdnmd)). A manifest is optional: a pack with nothing to add needs none.

## A license

Put a license file at the repository root, and choose a permissive one if the skills are to be served whole: a license that does not allow copies keeps the content at the source and the skill is only described, and a pack without one is served with a notice and never featured ([licenses](../specs/skill-repo.md#licenses)). A skill may carry a license of its own, as a file in its directory or a `license` field.

## Check it before you push

`skillcdn check` reads the directory as a deployment would index it and prints what an agent would get, with a warning for everything that will not be served as you meant it. It needs no account and no server ([checking a repository](../specs/skill-repo.md#checking-a-repository-before-pushing)):

```sh
npx @skillcdn/cli check
```

It exits with `1` when something could not be read as intended, so it can gate a push from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

## Publish

Push to a public repository on GitHub and open its page: `https://skillcdn.ai/gh/<owner>/<repo>`. The first look indexes the commit. A branch is looked up again after a short while, and where the deployment's GitHub App is installed on the repository, a push is served by the very next request. The page shows what an agent gets, with the connection guide first, and the explorer's card for the repository. A few things that make the page, and the agent's view, better:

- **Translations for people.** `translations` in the manifest and `skillcdn.translations` in a skill give the page a title and a description in another language; agents keep reading the original ([recommended](../specs/skill-repo.md#recommended)).
- **A picture.** `image` in the manifest names a file of the repository or an `https` URL; the explorer's card and the page show it.
- **A badge in your README**, so that readers see where the skills are served and how many there are ([the badge](../specs/rest.md#get-badgeaddress)):

  ```md
  [![SkillCDN](https://skillcdn.ai/badge/gh/<owner>/<repo>)](https://skillcdn.ai/gh/<owner>/<repo>)
  ```

- **Tags for versions.** An address with a tag, `@v1.2.0`, serves exactly what was reviewed; recommend one to people who need their results to stay the same ([addresses](../specs/address.md)).

The reference pack, [skillcdn/skills](https://github.com/skillcdn/skills), is written in the format and kept working; read it for a pack with areas, shared pages and translations in use.
