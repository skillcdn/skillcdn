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

## A long original

A specification or a manual of hundreds of pages, with numbered clauses, tables of codes and definitions in a notation of its own, is laid out by its own numbers ([ADR-0081](../adr/0081-a-long-original-is-laid-out-by-its-own-numbers-in-sections-read-at-once.md)):

```
link-protocol/
  README.md                         the map of the set: the chapters in the order of the original
  01-scope-and-terms.md             a short chapter: one file
  04-link-control/                  a chapter too long for one file: a folder with a map of its own
    README.md                       which sections and which pages each file holds
    010-4.1-general.md              a number that keeps the order, then the first section the file holds
    030-4.2.6-link-resumption.md
  annex-c/
    README.md                       which rows of a long table each file holds
    020-table-c-2-modifier-codes-aa-to-dz.md
  index/                            lookup tables made from the chapters, found by their words alone
    SKILLCDN.md                     documents: [.]   search: { meaning: false }
    definitions.md
```

- **A heading carries the number and the name of the original**, `4.2.7 Detection of carrier loss`, `TABLE C-2 Modifier codes`. An agent asks a specification for a clause by its number and a table by its name; such a query is answered by the file whose heading names it, and a reference in the text is followed by its number.
- **What the original sets in a fixed-width font is a fenced code block**, with its indentation, one block across a page break. A definition is then read as it was written, and taken as data: `skillcdn code <pack> <folder>` prints every block under a folder.
- **A section is what an agent reads at once**: a few thousand characters. A table of several hundred rows under one heading is one section, read whole for one row; write it in sections of a few dozen rows, each under a heading that names its first and last row (`TABLE C-2 Modifier codes: AA to BZ`), with the header row repeated. A program still gets it as one table: `skillcdn rows <pack> <folder> --out codes.csv`, or the `rows` route of the REST API, which the outline of a document names. A table too long to copy is never copied out by a model.
- **Terms written together are found by each of them**: `open/closed/held` by `closed`, `ops.intake.queue` by `intake`. A section number or a version, `4.2.6`, is one word.
- **A reference by number is a link that names its section**: `[4.2.7](040-4.2.7-to-4.2.8-carrier-loss.md#4.2.7)`. The fragment is the words the heading begins with, in lower case and joined by hyphens, so the number alone is enough; a read of the page lists the section with the offset and the limit that read it, and an agent follows the reference into the clause instead of the file ([ADR-0082](../adr/0082-a-links-fragment-names-a-section-and-a-reference-is-resolved-to-it.md)). `skillcdn check` reports a fragment that names no section, `fragment_not_found`.
- **An index is a lookup table** from a name to the file and section that hold it, made mechanically, in a folder whose manifest keeps it to the words, so that it does not stand before the text itself in a search by meaning.

`skillcdn check` notes a section longer than one read carries, `section_large`, without failing for it.

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

### An original that is encrypted

A PDF that opens with a password travels as it was received, and the pack never holds the password ([ADR-0084](../adr/0084-an-encrypted-original-stays-encrypted-and-nothing-that-opens-it-is-in-the-pack-or-the-image.md)):

```
manuals/                      a repository of its own, private to the people cleared for the originals
  SKILLCDN.md
  docs/
    workshop/
      SKILLCDN.md             documents: [.]   originals: { encrypted: true, key-name: workshop-2026 }
      README.md               the map
      01-safety.md            source: sources/workshop-manual.pdf
      sources/
        workshop-manual.pdf   as received, still encrypted; no copy without its protection
```

- **The password is not in the pack**: not in a front-matter, a manifest or a note. Everything of a pack is served as text to whoever reads it, into the context of every agent, and stays in the history of its repository. `key-name` is the name your organization knows the key by, so that a person knows which one to ask for; it is one word and never the key.
- **It is not in the image or the deployment either.** SkillCDN opens no original: it indexes the chapters and sends the file as it is. Nothing takes a password, so there is nothing to configure and nothing to leak; an image in particular is a file that is copied and stored, and whoever holds it reads all of it.
- **It is used once, and kept nowhere.** The conversion asks for it when it runs, from the person who runs it or from where your organization keeps its secrets for that one run, and writes it into no file, no history and no conversation. Nothing that serves the pack needs it afterwards; the people who open the original itself hold it as they did before.
- **The chapters are the original opened, so what protects them is who reads the pack.** A password is one secret for everyone and cannot be taken back from one reader; access to a pack is a credential each. The pack goes where only the people cleared for the originals read: a private repository of its own, where the git host says who they are, or the directory of a deployment that reads its packs with a token only, where its operator gives each agent a token of its own ([deploy](../../deploy/README.md#packs-from-a-directory-of-the-deployment), [ADR-0088](../adr/0088-the-packs-of-a-directory-may-be-read-with-a-token-only-and-a-password-is-used-once.md)). Originals for different readers are different packs.
- **Behind such access, whether the original stays encrypted is your organization's choice.** Kept as received, it is declared as above. Kept opened beside its chapters, without the declaration, no reader needs the password and it need not be passed on to anyone; a pack that everyone may read holds neither.

A result that names such an original says `encrypted, key workshop-2026`, so an agent does not fetch a file it cannot read. `skillcdn check` looks at each PDF under a manifest that says its originals are encrypted and fails on one that is not, notes an encrypted PDF that no manifest speaks of, and reports a front-matter key written to hold a password, `password_in_front_matter`, by its name and never its value. A password that was pushed is changed.

Conversion keeps what the original says. Nothing is left out of the text for being personal or secret: who reads the pack is decided by the visibility of its repository ([who may read it](write-a-repository.md#who-may-read-it)), and material that is not for everyone goes in a private repository, originals included. What looks secret or personal is pointed out at conversion, with the repository's visibility, and the person decides whether to keep it, to leave it out of the text, which leaves it in the original, or to make the repository private.

## The pictures

A picture is part of the document it belongs to: kept beside it, in `images/` by convention, and linked from where it belongs with the words an agent reads it by, alternative text that says what the picture shows, or a caption under it. The agent that converts writes those words from what it sees, a diagram described, a scanned page transcribed, a table written out ([ADR-0063](../adr/0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md)); the index searches them like any text and embeds no picture. The outline of a document names its pictures with their words, a folder listing says how many pictures a folder holds, and `skillcdn check` reports a picture without any words and a picture that is not there.

```markdown
![Block diagram of the receiver: antenna, front end, demodulator and the bus to the processor](images/receiver.png)
```

## Working a pack

An agent working a large pack reads the map, searches, reads the sections a result names, and keeps what it learned as notes committed to the repository through its own access to git, as documents in a document set of their own, so that the next run finds them ([document packs](../specs/skill-repo.md#document-packs)). A note says that it is one, and quotes exactly ([ADR-0083](../adr/0083-a-document-made-from-the-packs-documents-says-so-and-its-quotations-are-checked.md)): `derived` in its front-matter, with `kind`, `from`, `by` and `at`, and every quotation in a block quote whose last line links to the section quoted:

```markdown
---
title: Carrier loss and resumption
description: When a carrier counts as lost and how long a buoy tries to resume, each point quoted from its clause.
derived:
  kind: note
  from: ../link-protocol
  by: a run that answered questions about link failures
  at: 2026-11-11
---
## When the carrier counts as lost

> At the count maxSilentWindows the carrier is lost.
>
> — [4.2.7](/docs/link-protocol/04-link-control/040-4.2.7-to-4.2.8-carrier-loss.md#4.2.7)
```

`skillcdn check` holds each quotation against the section its link names and reports one that is not there word for word, a block quote without its link, and a note whose source has changed under it; a search result marks the note, and an agent that finds it quotes the clause. Nothing of this is in the server: SkillCDN indexes what the repository holds and serves it; the understanding of pictures at conversion and the reading at work are the agent's, with the skills of the reference pack or with skills of your own.
