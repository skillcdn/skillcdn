# Spec: the SkillCDN Format

- Status: **Draft.**
- Implemented by: `packages/core` (`parseSkillManifest`, `classifyRepoFile`, `summarizeMarkdown`). Fixtures live in [`skills/`](../../skills/); the reference repository, written in the format and served live, is `skillcdn/examples`.

How SkillCDN reads a repository, and how a repository is written so that an agent uses it well. The layout is the [Agent Skills](https://agentskills.io/specification) layout: a repository that already works as a skills folder works here unchanged. That layout, together with the conventions that grow around it (what sits next to `SKILL.md`, what the repository root says, how plain documents are written), is the **SkillCDN Format**. This file is its specification; user documentation will be rendered from it.

```
repo/
  README.md                 what the repository is: the first document an agent and a person read
  SKILL.md                  a single-skill repo, or
  skills/
    <name>/SKILL.md         a multi-skill repo; front-matter carries name, description, ...
    <name>/references/      documents the body points to
    <name>/assets/          small data files the skill reads
    <name>/scripts/         optional helpers; served as text, never run
  docs/ (any name)          plain documents: listed, searched and read without a skill
  .github/, .anything       hidden: never listed, searched or read
  skillcdn.yaml             not yet: see the open questions
```

## Reading rules

What the indexer does with a repository. These hold for every repository, whether or not it follows the rest of the format.

- **A skill is a directory that holds a file named exactly `SKILL.md`**, at any depth inside the mounted path. `skills/<name>/SKILL.md` is the usual layout; a `SKILL.md` at the mounted root makes the whole mount one skill. A file belongs to the nearest skill directory above it, so a nested skill owns its own files.
- `SKILL.md` is YAML front-matter followed by a Markdown body. Everything else in the skill directory is a supporting file the body may point to.
- A repo without any skill manifest still works, as a document-reading endpoint: `find` and `read_file` only.
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

- A manifest that breaks a rule for a required field, has no front-matter, or has front-matter that is not valid YAML is **skipped and reported**. It never fails the whole repo.
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
6. **The root has a `README.md`** that starts with a level-one heading and one paragraph saying what the repository is. That is the document the page of the address shows first and what `find` lists for it.
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

### The repository root

A client is told the repository, the commit and the mounted path, and the catalog of skills ([tools](tools.md)). The name of a mount is its address; the description shown for a repository is the one its git host shows ([REST](rest.md)). The root `README.md` is a document like any other, listed first by the page of the address. There is no root manifest yet that names or describes the repository, declares shared rules for its skills, or aliases; see the open questions.

## Parsing requirements

Everything in a repo is untrusted input:

- YAML is parsed with the failsafe schema: strings, mappings and sequences only, so `1.0` and `no` stay the text the author typed. Explicit tags, aliases, duplicate keys, non-string keys and a second document are errors. Front-matter is at most 16,384 characters and a manifest at most 262,144.
- Front-matter fields are validated against the table above. Text that carries control or invisible characters is rejected, never cleaned up.
- Paths from manifests are normalized and must stay inside the mounted root. Symlinks are not followed.
- Links inside Markdown are text. Nothing resolves or follows them on the server.

## Open questions

- A root manifest: whether the format should let a repository name and describe itself instead of relying on the git host, declare rules that every skill in it restates, and enable modules. The leading candidate is a Markdown file with front-matter at the root, the repository's counterpart of `SKILL.md`: the front-matter carries what a client is told (name, description), the body carries the rules that hold for every skill, and the server can hand both to a client with the catalog. A YAML file stays the fallback for configuration that is not prose. How much of it is needed versus inferred from `SKILL.md` front-matter.
- Which files a mount should hide. Today every file in the tree is listed by `read_file` and every Markdown and JSON file is searched, tooling included (`.github/`, editor settings, check scripts). Candidates: skipping dot-directories and dotfiles by default, and an ignore list in the root manifest; a separate ignore file is a parser of its own.
- The exact rules for *verified*, and the wording of the provenance warning.
- How `intake` questions are declared.
- How skills that need user files describe an upload step, given that remote MCP servers cannot receive chat attachments.
- Whether the explorer reports the format's required points 3 to 6 as diagnostics, next to the manifest diagnostics it already reports.
