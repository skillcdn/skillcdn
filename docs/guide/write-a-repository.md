# Write a pack

A pack is a git repository that an agent connects to as one unit: the skills it follows, the documents it reads, and the rules that hold for all of them. Push it to GitHub, and its address serves the pack to any AI app that connects: `https://skillcdn.ai/gh/<owner>/<repo>`, or the same path on a deployment of your own. One repository may hold skills, documents, or both; a pack that is mostly skills is written as [writing skills](write-skills.md) says, one that is mostly documents as [writing documents](write-documents.md) says, and this page is what both share. The layout is the [Agent Skills](https://agentskills.io/specification) layout, so a folder of skills that already works elsewhere works here unchanged; [the SkillCDN Format](../specs/skill-repo.md) is that layout plus a few conventions that make a pack useful to an agent, and it is the reference for every rule these pages mention. The reference pack, [skillcdn/skills](https://github.com/skillcdn/skills), is written in the format and kept working: an example of all of this in use, not a second definition of it.

## What a pack is made of

```
my-pack/
  SKILLCDN.md               optional: the pack's name, description, document roots, language, rules
  LICENSE                   what a deployment may pass on
  skills/
    release-notes/SKILL.md  a skill: front-matter and instructions
  docs/
    README.md               the map of a document set: one line per document
    handbook.md             a document: a title, a description, headings that name its parts
```

- **A skill** is a directory with a `SKILL.md`: YAML front-matter that names and describes it, then the instructions an agent follows, with the files it points to beside it ([writing skills](write-skills.md)).
- **A document** is a Markdown file in a document set, a directory of Markdown under `docs/` or under a directory the manifest names, with a title and a description, headings that name its parts, and a `README.md` in every set as its map ([writing documents](write-documents.md)).
- **The manifest**, `SKILLCDN.md`, is optional. Its front-matter names and describes the pack, declares the document roots and the language, and its body is the rules that travel with every skill ([the repository manifest](../specs/skill-repo.md#the-repository-manifest-skillcdnmd)).

An agent that connects browses the folders, searches the words and the meaning of everything, loads a skill whole with the rules in front of it, and reads a document by its sections. A person opens the page of the address and sees the same.

## The manifest and the shared rules

Rules that hold for every skill go in `SKILLCDN.md` at the repository root. Its front-matter names and describes the pack, and its body is delivered to the agent with every skill:

```markdown
---
name: Acme pack
description: The pack of Acme's marketing and product teams. Use to write, review and publish in the house style.
documents:
  - docs
language: en
license: MIT
---
# Rules for every skill in this pack

**One question at a time.** When a skill needs something it cannot derive, it asks for it in one short message, then goes on.

**Show before you publish.** Nothing leaves the conversation until the user has seen the draft.
```

A larger pack puts one folder per area of work, each with a `SKILLCDN.md` that says who its skills are for and adds the area's rules; connect the root for everything, or an area's folder for that area alone. `language` tells the agent what language to search in and chooses how the words are matched: an English pack is matched by word stems, a Korean, Japanese or Chinese one by pairs of characters; a folder written in another language gets a manifest of its own ([the words that match](../specs/tools.md#the-words-that-match)). A manifest is optional: a pack with nothing to add needs none.

Two things about YAML catch most authors: a colon followed by a space inside a plain value, and a space followed by a hash. Quote such a value, or write it as a block scalar, which takes any text ([writing the values](../specs/skill-repo.md#writing-the-values)).

## Who may read it

A pack is served to whoever the git host lets see its repository: everyone, for a public repository; the people who can see it, for a private one, signed in or with a token an agent holds ([people, private repositories and access](../specs/permissions.md)). That is the whole rule about what a pack may hold: nothing in a public repository that is not for everyone, and material that is not for everyone, a secret, personal data, the originals of a document pack, in a private repository, whole ([required](../specs/skill-repo.md#required)). Nothing is stripped from a document to make it fit a public repository; the repository's visibility is chosen instead.

## A license

Put a license file at the repository root, and choose a permissive one if the content is to be served whole: a license that does not allow copies keeps the content at the source and a skill is only described, and a pack without one is served with a notice and never featured ([licenses](../specs/skill-repo.md#licenses)). A skill may carry a license of its own, as a file in its directory or a `license` field. A directory served from a machine is served in full by whoever chose it, whatever its license says.

## Check it before you push

`skillcdn check` reads the directory as a deployment would index it and prints what an agent would get, with a diagnostic for everything that will not be served as you meant it: a `SKILL.md` whose front-matter does not parse, a link that names no file, a picture without alternative text, an original that is not there. It needs no account and no server ([checking a repository](../specs/skill-repo.md#checking-a-repository-before-pushing)):

```sh
npx @skillcdn/cli check
```

It exits with `1` when something could not be read as intended, so it can gate a push from a script or a CI job:

```yaml
- run: npx @skillcdn/cli check
```

The same command reads a directory as an agent would get it, `skillcdn skills`, `browse`, `find`, `skill` and `file`, and `skillcdn serve` serves it over MCP and HTTP from the machine, before anything is pushed ([the command](../../packages/cli/README.md)).

## Publish

Push to a repository on GitHub and open its page: `https://skillcdn.ai/gh/<owner>/<repo>`. The first look of a person or an agent indexes the commit; a search engine's crawler, or the preview of a link in a chat, is shown only what was indexed already, so a link shared before anyone has opened the page unfurls with the site's own card. A branch is looked up again after a short while, and where the deployment's GitHub App is installed on the repository, a push is served by the very next request. The page shows what an agent gets, with the connection guide first, and the explorer's card for the repository. A few things that make the page, and the agent's view, better:

- **Translations for people.** `translations` in the manifest and `skillcdn.translations` in a skill give the page a title and a description in another language; agents keep reading the original ([recommended](../specs/skill-repo.md#recommended)).
- **A picture.** `image` in the manifest names a file of the repository or an `https` URL; the explorer's card and the page show it.
- **A badge in your README**, so that readers see where the pack is served and how many skills it has ([the badge](../specs/rest.md#get-badgeaddress)):

  ```md
  [![SkillCDN](https://skillcdn.ai/badge/gh/<owner>/<repo>)](https://skillcdn.ai/gh/<owner>/<repo>)
  ```

- **Tags for versions.** An address with a tag, `@v1.2.0`, serves exactly what was reviewed; recommend one to people who need their results to stay the same ([addresses](../specs/address.md)).

A pack that cannot live at a git host, on a machine without one or in a network that reaches none, is served from a directory instead: by the `skillcdn` command from the machine that holds it, or by a deployment of your own from a directory it is given ([self-hosting](../../deploy/README.md#packs-from-a-directory-of-the-deployment)).
