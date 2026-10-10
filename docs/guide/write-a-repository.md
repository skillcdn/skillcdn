# Write a skill repository

A skill repository is a git repository with a `SKILL.md` for each skill. Push it to GitHub, and its address serves the skills to any AI app that connects: `https://skillcdn.ai/gh/<owner>/<repo>`, or the same path on a deployment of your own. The layout is the [Agent Skills](https://agentskills.io/specification) layout, so a folder of skills that already works elsewhere works here unchanged; [the SkillCDN Format](../specs/skill-repo.md) is that layout plus a few conventions that make a repository useful to an agent, and it is the reference for every rule this page mentions.

## The smallest repository

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

That is a complete, servable skill. The `name` is the directory's name, in lowercase letters, digits and hyphens. The `description` says what the skill does and when to use it, in the words a user would say: it is what search ranks first, and what an agent reads to decide whether to load the skill at all. The body is what the agent follows ([front-matter](../specs/skill-repo.md#front-matter)).

Two things about YAML catch most authors: a colon followed by a space inside a plain value, and a space followed by a hash. Quote such a value, or write it as a block scalar ([writing the values](../specs/skill-repo.md#writing-the-values)):

```yaml
description: >
  Makes a video: fast and cheap. Use when the user wants a promo
  short for their product.
```

## The body of a skill

An agent that has read one skill should know where to look in the next, so the recommended order is: a title and a one-paragraph summary of what comes out from what; the requirements, that is the tools the skill calls and what to do when one is missing; the inputs, what the user must supply and the questions to ask for gaps; the workflow, as numbered phases that name what each consumes and produces and where the user is consulted; the hard rules an agent must never break; and the terms the skill uses with a fixed meaning ([recommended](../specs/skill-repo.md#recommended)).

Keep the body to a few hundred lines. About 16 KiB of text for the body and everything it requires on every run is a useful target: an agent receives a skill in pages, and the rules of the repository and the response metadata take room of their own.

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

Everything an agent must read is Markdown or small JSON. Other files are listed and can be read, but they are not searched, and nothing in the repository is ever executed by SkillCDN ([references](../specs/skill-repo.md#markdown-references)).

## Documents and shared rules

A repository can serve plain documents next to its skills: Markdown files under `docs/` are listed, searched and read without a skill around them, and a skill can link to them. A page that several skills need on every run, what they all know about one tool for instance, lives once under `docs/` and is included by each skill with a root-relative path, `/docs/<tool>/models.md` ([shared pages](../specs/skill-repo.md#shared-pages)).

Rules that hold for every skill go in `SKILLCDN.md` at the repository root. Its front-matter names and describes the repository, and its body is delivered to the agent with every skill:

```markdown
---
name: Acme skills
description: Skills for Acme's marketing and product teams. Use to write, review and publish in the house style.
documents:
  - docs
license: MIT
---
# Rules for every skill in this repository

**Ask only what cannot be derived.** A skill asks for the inputs it cannot get from the request, in one short message.

**Spend only with consent.** Anything that costs the user money or credits is estimated first and started only after they agree.
```

A larger repository puts one folder per area of work, each with a `SKILLCDN.md` that says who its skills are for and adds the area's rules; connect the root for everything, or an area's folder for that area alone ([the repository manifest](../specs/skill-repo.md#the-repository-manifest-skillcdnmd)). A manifest is optional: a repository with nothing to add needs none.

## A license

Put a license file at the repository root. What a deployment may pass on follows the license it finds: a permissive license (MIT, Apache-2.0, CC-BY-4.0 and the like) is served whole with its notice; a restrictive one, or a text the reader does not recognize, keeps the content at the source and the skill is only described; a repository without a license is served with a notice and is never featured ([licenses](../specs/skill-repo.md#licenses)). A skill may carry a license of its own, as a file in its directory or a `license` field.

## Check it before you push

`skillcdn check` reads a directory as a deployment would index it, with the same code and the same limits, and prints what an agent would get: every skill with its files and warnings, the documents, what is not served, and the instructions a client is told on connect. It needs no account and no server ([checking a repository](../specs/skill-repo.md#checking-a-repository-before-pushing)):

```sh
npx @skillcdn/cli check
```

It exits with `1` when something could not be read as intended, so it can gate a push from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

## Publish

Push to a public repository on GitHub and open its page: `https://skillcdn.ai/gh/<owner>/<repo>`. The first look indexes the commit; from then on every push is picked up on the next request. The page shows what an agent gets, with the connection guide first, and the explorer's card for the repository. A few things that make the page, and the agent's view, better:

- **Translations for people.** `translations` in the manifest and `skillcdn.translations` in a skill give a title and a description for people reading the page in another language. Agents keep reading the original, so write the original in English unless your users do not.
- **A picture.** `image` in the manifest names a file of the repository or an `https` URL; the explorer's card and the page show it.
- **A badge in your README**, so that readers see where the skills are served and how many there are:

  ```md
  [![SkillCDN](https://skillcdn.ai/badge/gh/<owner>/<repo>)](https://skillcdn.ai/gh/<owner>/<repo>)
  ```

- **Tags for versions.** An address with a tag, `@v1.2.0`, serves exactly what was reviewed; recommend one to people who need their results to stay the same ([addresses](../specs/address.md)).

The reference repository, [skillcdn/skills](https://github.com/skillcdn/skills), is written in the format and kept working; read it for a repository with areas, shared pages and translations in use.
