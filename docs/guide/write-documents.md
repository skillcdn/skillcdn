# Write documents

A pack needs no skill at all: a handbook, a product manual, a body of specifications or reports is served as a pack of documents, and an agent that connects browses it, searches it by words and by meaning, and reads what it needs by sections ([document packs](../specs/skill-repo.md#document-packs)). What every pack shares, the manifest, the license, who may read it, the check, publishing, is in [writing a pack](write-a-repository.md); a repository may hold skills beside its documents, written as [writing skills](write-skills.md) says, and a document pack often does, to say how its documents are worked. The rules on this page are [the SkillCDN Format](../specs/skill-repo.md)'s, which is the reference. The steps an agent follows to make such a pack from a person's files, and to work one, are skills of the reference pack, [skillcdn/skills](https://github.com/skillcdn/skills): `skillcdn-document-pack` and `skillcdn-document-research`, served at `skillcdn.ai/gh/skillcdn/skills`, and readable without a connection:

```sh
npx @skillcdn/cli skill gh/skillcdn/skills engineering/skills/skillcdn-document-pack/SKILL.md
```

They follow the format and define nothing of it; a pack made by hand, or by a skill of your own, is served the same.

## The shape of a document pack

```
handbook/
  SKILLCDN.md               name, description, documents: [docs], language: en
  docs/
    README.md               the map: one line per document, what each holds
    getting-started.md      one file per document or chapter, with a title and a description
    billing.md              headings that name the parts, since sections are what search finds
    manual/
      README.md             the map of the set: the chapters in the order of the original
      01-introduction.md    a chapter, with the heading path of the original at its top
      02-interfaces.md
      images/               the figures, linked from the chapters with the words that describe them
      sources/              the originals the chapters were made from
        manual-rev3.pdf
```

- **One file per document or chapter**, with a front-matter `title` and `description`, or a first heading and a summary paragraph. Not one file per page, which carries no summary, and not one file per book, which is too large to read by sections; a deployment indexes a file up to its per-file limit and serves it up to its read limit, and `skillcdn check` names a document too large to be searched. A chapter cut from a larger original carries the heading path above it, its part and chapter, at its top, so that a section read alone still says what it belongs to.
- **Headings that name the parts.** A search result names the sections that matched, with the offset and the limit that read each one, and `browse_repo` given the file answers its outline, so an agent walks a long document by its headings instead of reading it whole; a heading's words weigh more than the body's in search, so a code or a name in a heading finds its section first.
- **A map in every document set**: the `README.md` of the folder, one line per document in the order they are read, the title linked to the file with what it holds; for a set cut from one original, the chapters in the order of the original. An agent reads the map before it searches, and a search result marks the map as the overview of its folder, so that the agent goes on to the document it names.
- **The manifest declares the document roots and the language.** `documents` names the directories that hold documents, `docs` unless said otherwise; `language` tells the agent what language to search in and chooses how the words are matched; a folder written in another language gets a manifest of its own. A repository that declares itself with a manifest is also embedded for the search by meaning ahead of any search, where a deployment searches by meaning; one without is searched by its words until someone searches it ([the worker](../../deploy/README.md#the-worker)).

## The originals

The files the documents were made from, the PDF, the office document, the scan, travel in the pack: in `sources/` inside the document set they belong to, committed like any other file ([ADR-0076](../adr/0076-originals-travel-in-the-pack-and-the-repositorys-visibility-decides-who-reads-them.md)). They are listed and never searched; what an agent gets of one is a link that opens, at the git host, at the deployment's own route for a pack served from its directory, or on the machine for a directory the command reads ([reading a file](../specs/tools.md#raw-files)).

A document names its originals in the front-matter `source`, the path written as a link destination is, relative to the document, or a list of them:

```markdown
---
title: Interfaces
description: The interfaces of the unit, their messages and their timing.
source: sources/manual-rev3.pdf
---
```

Every result names the original with the document, the outline in its header and a read on its first page, each with where the bytes are, so that an agent checking a figure, a table or a transcription, or a person wanting the file itself, gets there in one step. A page of the original is said in words, "page 12 of the original": the hosts send originals as downloads, and an anchor into a page does nothing there. An original over what the host takes as it is, 100 MB at GitHub, goes through Git LFS; a read of its pointer sends the reader to where the host serves the file. `skillcdn check` reports a `source` that names no file of the repository.

Conversion keeps what the original says. Nothing is left out of the text for being personal or secret: who reads the pack is decided by the visibility of its repository ([who may read it](write-a-repository.md#who-may-read-it)), and material that is not for everyone goes in a private repository, originals included. What looks secret or personal is pointed out at conversion, with the repository's visibility, and the person decides whether to keep it, to leave it out of the text, which leaves it in the original, or to make the repository private.

## The pictures

A picture is part of the document it belongs to: kept beside it, in `images/` by convention, and linked from where it belongs with the words an agent reads it by, alternative text that says what the picture shows, or a caption under it. The agent that converts writes those words from what it sees, a diagram described, a scanned page transcribed, a table written out ([ADR-0063](../adr/0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md)); the index searches them like any text and embeds no picture. The outline of a document names its pictures with their words, a folder listing says how many pictures a folder holds, and `skillcdn check` reports a picture without any words and a picture that is not there.

```markdown
![Block diagram of the receiver: antenna, front end, demodulator and the bus to the processor](images/receiver.png)
```

## Working a pack

An agent working a large pack reads the map, searches, reads the sections a result names, and keeps what it learned as notes committed to the repository through its own access to git, as documents in a document set of their own, so that the next run finds them ([document packs](../specs/skill-repo.md#document-packs)). Nothing of this is in the server: SkillCDN indexes what the repository holds and serves it; the understanding of pictures at conversion and the reading at work are the agent's, with the skills of the reference pack or with skills of your own.
