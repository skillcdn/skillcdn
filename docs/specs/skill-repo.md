# Spec: the SkillCDN Format

- Status: **Draft.**
- Implemented by: `packages/core` (`parseSkillManifest`, `parseRepoManifest`, `classifyRepoFile`, `isServedPath`, `summarizeMarkdown`). Fixtures live in [`apps/server/fixtures/.repositories/`](../../apps/server/fixtures/.repositories/); the reference repository, written in the format and served live, is `skillcdn/examples`.

How SkillCDN reads a repository, and how a repository is written so that an agent uses it well. The layout is the [Agent Skills](https://agentskills.io/specification) layout: a repository that already works as a skills folder works here unchanged. That layout, together with the conventions that grow around it (what sits next to `SKILL.md`, what the repository root says, how plain documents are written), is the **SkillCDN Format**. This file is its specification; user documentation will be rendered from it.

```
repo/
  SKILLCDN.md               the repository manifest: name, description, which directories hold
                            documents, and the rules that hold for every skill
  README.md                 what the repository is, for whoever reads it on the git host; not served
  SKILL.md                  a single-skill repo, or
  skills/
    <name>/SKILL.md         a multi-skill repo; front-matter carries name, description, ...
    <name>/references/      documents the body points to
    <name>/assets/          small data files the skill reads
    <name>/scripts/         optional helpers; served as text, never run
  docs/                     plain documents: listed, searched and read without a skill; another
                            directory is served only when the manifest names it
  .github/, .anything       hidden: never listed, searched or read
```

## Reading rules

What the indexer does with a repository. These hold for every repository, whether or not it follows the rest of the format.

- **A skill is a directory that holds a file named exactly `SKILL.md`**, at any depth inside the mounted path. `skills/<name>/SKILL.md` is the usual layout; a `SKILL.md` at the mounted root makes the whole mount one skill. A file belongs to the nearest skill directory above it, so a nested skill owns its own files.
- `SKILL.md` is YAML front-matter followed by a Markdown body. Everything else in the skill directory is a supporting file the body may point to.
- **Documents are the files of `docs`**, the conventional directory at the root of the repository, or of whatever a manifest governs; a manifest can name other directories instead ([the repository manifest](#the-repository-manifest-skillcdnmd)). Outside the skills and the document directories nothing is served: not the root `README.md`, not the tooling of the repository.
- A repository without any skill still works, as a document-reading endpoint for `docs`: `find` and `read_file` only.
- **Hidden entries are never served.** A file with any path segment that starts with a dot (`.github/workflows/ci.yml`, `.editorconfig`, `.claude/settings.json`) is not listed, not searched and cannot be read, and takes no room in the index. Such files are tooling for the repository, not content for an agent.
- **Repositories declare; they never ship code that we execute.** Composition ("take this input, call these tools in this order") will be declared in Markdown or YAML. Scripts in a repo are files like any other: readable, never run. `allowed-tools` is passed through as text and grants nothing.
- Indexed content: skill manifests, Markdown (`.md`, `.markdown`, `.mdx`) and small JSON. Every other file is listed and can be read, but is not searched. Binary and oversized files are skipped. Limits are configuration with safe defaults.
- A plain Markdown document is listed under its front-matter `title` and `description` when it has them; otherwise its title is its first level-one heading, and its description is the first paragraph after that heading (or the first paragraph of the document when there is no heading), shortened to 200 characters. Links become their text; badges, images, lists, quotes, tables and code are skipped on the way.
- Repos where the GitHub App is installed are **verified**. Responses from unverified repos carry a provenance warning.

## Front-matter

| Field | Required | Rule |
|---|---|---|
| `name` | yes | 1 to 64 characters on one line. |
| `description` | yes | 1 to 1024 characters. What the skill does and when to use it; this is what `find` searches first. |
| `license` | no | Short text. |
| `compatibility` | no | 1 to 500 characters. |
| `allowed-tools` | no | Text, passed through. |
| `metadata` | no | Mapping from short text keys to short text values. |

- A manifest that breaks a rule for a required field, has no front-matter, or has front-matter that is not valid YAML is **skipped and reported**. It never fails the whole repo. The file stays readable, so that the author can see what was found; it is listed and searched only where a document would be.
- A `name` that ignores the naming convention (lowercase letters, digits and single hyphens) or differs from its directory name is **served with a warning**. The directory rule does not apply to a manifest at the mounted root.
- An optional field that cannot be used is ignored with a warning. Unknown fields are ignored silently, so the convention can grow.
- Two skills may share a `name`; the skill directory is what identifies a skill.

## The format

The reading rules say what is served. The format says what a repository needs so that what is served is used well: an agent that connects learns the skills from their descriptions, loads one with `get`, and reads the files it points to with `read_file`; a person opens the page of the address and reads what the repository is.

### Required

A repository is in the SkillCDN Format when all of these hold. They are what the explorer checks and what the reference repository's own check enforces.

1. **Every skill directory has a `SKILL.md`** whose front-matter passes the table above, whose `name` follows the naming convention and equals the directory name, and whose body starts with a level-one heading.
2. **The `description` says what the skill does and when to use it**, in the words a user would say. It is what `find` ranks first and what a client is told about the skill when it connects.
3. **A skill is self-contained.** Its files link only inside its own directory, because a skill may be mounted alone (`.../<repo>/skills/<name>`) and a link that leaves the mount cannot be read through it. Anything a skill depends on is restated inside it, or linked by address.
4. **Everything an agent must read is Markdown or small JSON.** Other files are listed and readable, never searched; rendered media and binaries are not part of a skill.
5. **Nothing has to run.** A skill works from its `SKILL.md` and the documents it points to. Scripts may be shipped as help for agents that run locally, and are served as text.
6. **The root has a `SKILLCDN.md`** that names and describes the repository, declares the directories that hold its documents, and states the rules that hold for every skill. `README.md` is for whoever reads the repository on the git host; the manifest is what an agent is told.
7. **No secrets, no private hostnames, no real people's identity or likeness**, in any file. The repository is served to whoever holds the address.

### Recommended

The layout of a skill:

```
skills/<name>/
  SKILL.md              front-matter and the instructions; kept to a few hundred lines
  references/           documents the body points to from the phase that needs them
  assets/               small data files the skill reads: example JSON, schemas
  scripts/              optional helpers for agents that run locally
```

The body of a `SKILL.md`, in this order, so that an agent that has read one knows where to look in the next: a title and a one-paragraph summary of what comes out from what; the requirements, that is the tools the skill calls and what to do when one is missing; the inputs, what the user must supply and the questions to ask for gaps; the workflow, as numbered phases that name what each consumes and produces and where the user is consulted; the hard rules an agent must never break; and the terms the skill uses with a fixed meaning.

Plain documents (a document set is a directory of Markdown without a `SKILL.md`) carry a front-matter `title` and `description`, or start with a level-one heading followed by one summary paragraph, because that is what search shows.

### A repository without a manifest

A client is told the repository, the commit and the mounted path, and the catalog of skills ([tools](tools.md)). The name of a mount is its address; the description shown for a repository is the one its git host shows ([REST](rest.md)). The mount serves its skills and the documents in `docs` at the repository root, nothing else. A repository whose documents live elsewhere, or that wants a name, a description or rules, adds the manifest.

### The repository manifest: `SKILLCDN.md`

A file named exactly `SKILLCDN.md` is to a repository what `SKILL.md` is to a skill: YAML front-matter that says what a client is told, and a Markdown body with the rules that hold for every skill in the repository ([ADR-0014](../adr/0014-the-repository-manifest-decides-what-a-mount-serves.md)). It is read with the same parser and the same limits as `SKILL.md`, and it is visible on the git host as a document like any other.

```markdown
---
name: SkillCDN examples
description: Example skills and document sets, served live through SkillCDN. Use to see how a skill that drives a given tool is written.
documents:
  - docs
license: MIT
metadata:
  author: skillcdn
---
# Rules for every skill in this repository

- Ask when a choice changes the result; ask once, batched, only for what is missing.
- Anything that costs the user money is estimated first and started only after they agree.
- ...
```

| Field | Required | Rule |
|---|---|---|
| `name` | no | 1 to 100 characters on one line. Default: the repository's name on the git host. |
| `description` | yes | 1 to 1024 characters. What the repository holds and who it is for. Shown on the page of the address, in the server instructions and in the description of `find`, instead of the host's description. |
| `documents` | no | A sequence of directories relative to the manifest (`docs`, `docs/` or `.` for the manifest's own directory), no `..`, at most 20; an entry that is not such a path is dropped and reported. Their Markdown and JSON are listed and searched, and every file in them can be read. Default: `docs`, next to the manifest; an empty sequence serves no documents. |
| `license` | no | Short text, as in `SKILL.md`. |
| `metadata` | no | Mapping from short text keys to short text values, as in `SKILL.md`. |

What changes when a mount has a manifest:

- **Only what is declared is served.** The mount exposes its skills (every directory with a `SKILL.md`, as before), the directories named in `documents` (`docs` when the field is absent), and the manifest itself. Nothing else is listed, searched or read: not the root `README.md`, not the check scripts, not the documentation of the repository's own conventions. The index knows every file of the tree and marks the rest as not served, so any later index (embeddings, for one) covers the same set and nothing more. The manifest itself is readable but not listed as a document.
- **The body is the repository's rules.** The server hands it to the client with every skill: `get` and the skill's prompt return it as a section before the skill's own body, named after the manifest's path, and the server instructions say that the repository has rules and that they come with every skill. A skill no longer restates them. The body is kept short; past a limit it is cut with a note, and `read_file` has the rest ([tools](tools.md)).
- **The name and the description come from the manifest**, on the page, in the server instructions and the server info, in the connection guide (the name, as a slug, is what the client configuration calls the server) and in the [REST](rest.md) answer, instead of from the host.
- **A manifest that cannot be read fails closed**: it is reported as a diagnostic like a broken `SKILL.md`, and the mount serves its skills and the manifest only, so that a typo never exposes what the author meant to hide. The file stays readable, so the author can see what was found.
- **While the commit is being indexed** nothing has read the manifests yet, so under one only the skills and the manifests themselves are readable until the index is there: closed, not guessed.

Where it is looked up: at the mounted root; when there is none there, at each ancestor directory up to the repository root, nearest wins. A sub-path mount of a monorepo thus inherits the repository's manifest, and a directory with a manifest of its own is a project of its own; `documents` are clipped to the mount, and a manifest above the mount is not readable through it. A repository without a manifest serves its skills and `docs`, as the reading rules say.

The name: uppercase like `SKILL.md`, `README.md` and `AGENTS.md`, matched exactly, and it says which product reads it. A repository is in the SkillCDN Format once it has one.

## Parsing requirements

Everything in a repo is untrusted input:

- YAML is parsed with the failsafe schema: strings, mappings and sequences only, so `1.0` and `no` stay the text the author typed. Explicit tags, aliases, duplicate keys, non-string keys and a second document are errors. Front-matter is at most 16,384 characters and a manifest at most 262,144.
- Front-matter fields are validated against the table above. Text that carries control or invisible characters is rejected, never cleaned up.
- Paths from manifests are normalized and must stay inside the mounted root. Symlinks are not followed.
- Links inside Markdown are text. Nothing resolves or follows them on the server.

## Open questions

- Whether skills should also be confined to directories the manifest declares (`skills:`), or stay "any directory with a `SKILL.md`" as now; and whether modules and aliases belong in the manifest's front-matter or in configuration that is not prose (a YAML file stays the fallback for that).
- The exact rules for *verified*, and the wording of the provenance warning.
- How `intake` questions are declared.
- How skills that need user files describe an upload step, given that remote MCP servers cannot receive chat attachments.
- Whether the explorer reports the format's required points 3 to 6 as diagnostics, next to the manifest diagnostics it already reports.
