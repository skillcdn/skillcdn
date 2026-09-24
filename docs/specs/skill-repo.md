# Spec: the SkillCDN Format

- Status: **Draft.**
- Implemented by: `packages/core` (`parseSkillManifest`, `parseRepoManifest`, `classifyRepoFile`, `isServedPath`, `summarizeMarkdown`). Fixtures live in [`apps/server/fixtures/.repositories/`](../../apps/server/fixtures/.repositories/); the reference repository, written in the format and served live, is `skillcdn/skills`.

How SkillCDN reads a repository, and how a repository is written so that an agent uses it well. The layout is the [Agent Skills](https://agentskills.io/specification) layout: a repository that already works as a skills folder works here unchanged. That layout, together with the conventions that grow around it (what sits next to `SKILL.md`, what the repository root says, how plain documents are written), is the **SkillCDN Format**. This file is its specification; user documentation will be rendered from it.

```
repo/
  SKILLCDN.md               the repository manifest: name, description, which directories hold
                            documents, and the rules that hold for every skill
  README.md                 optional introduction, summarized for discovery and read on demand
  SKILL.md                  a single-skill repo, or
  skills/
    <name>/SKILL.md         a multi-skill repo; front-matter carries name, description, ...
    <name>/references/      documents the body points to
    <name>/assets/          small data files the skill reads
    <name>/scripts/         optional helpers; served as text, never run
  <area>/                   or one folder per area of work (marketing/, engineering/, ...)
    SKILLCDN.md             the area's manifest: who its skills are for, the rules they add
    README.md               the area's optional introduction
    skills/<name>/SKILL.md  the area's skills, laid out as above
    docs/                   the area's documents, discovered next to its manifest
  docs/                     plain documents: listed, searched and read without a skill;
                            other directories may be declared or individual Markdown files linked
  .agents/skills/<name>/    hidden ancestors do not hide an explicitly declared SKILL.md
```

## Reading rules

What the indexer does with a repository. These hold for every repository, whether or not it follows the rest of the format.

- **A skill is a directory that holds a valid file named exactly `SKILL.md`**, at any depth, including under hidden ancestors. The exact file declares the skill; no repository-specific folder names or allowlists are needed. A file belongs to the nearest skill directory above it, so a nested skill owns its own files. A root `SKILL.md` declares a root skill without suppressing nested skills.
- `SKILL.md` is YAML front-matter followed by a Markdown body. Everything else in the skill directory is a supporting file the body may point to.
- **Documents are discovered in `docs`**, at the repository root or next to the nearest governing manifest; a manifest can declare different directories ([the repository manifest](#the-repository-manifest-skillcdnmd)). These are bulk discovery roots, not a denylist. Linked Markdown files outside them can also be read ([references](#markdown-references)).
- **READMEs introduce visible folders.** The repository root and folders already exposed through skills or documents can supply an optional README overview, even without `SKILLCDN.md`. Discovery carries a short summary and canonical path; the full text is read only when needed. Overview eligibility alone does not add a searchable document or increase document counts ([introductions](#readme-introductions)).
- A repository without any skill still works as a document endpoint through `browse`, `search` and `read_file`.
- **Hidden paths require a declaration.** A valid `SKILL.md` declares its skill even under hidden ancestors. Ordinary supporting descendants are eligible, but additional hidden children require `skillcdn.include`, an explicit document-directory declaration or a Markdown link. A file link exposes that file, never its siblings. Unrelated hidden files remain excluded.
- **Explicit exclusions take precedence.** A manifest's `exclude` removes the named files or subtrees from every discovery and reading route, including valid skills, README overviews, includes and references. Descendant declarations cannot reopen excluded paths ([exclusions](#excluding-files-and-subtrees)).
- **Folders retain their real paths.** `browse` shows the same hierarchy whether or not manifests exist. A `SKILLCDN.md` adds metadata and rules to its folder. A skill belongs directly to the nearest manifest folder; ancestor counts include descendants without duplicating their identities.
- **Repositories declare; they never ship code that we execute.** Composition ("take this input, call these tools in this order") will be declared in Markdown or YAML. Scripts in a repo are files like any other: readable, never run. `allowed-tools` is passed through as text and grants nothing.
- Indexed content: skill manifests, Markdown (`.md`, `.markdown`, `.mdx`) and small JSON. Every other file is listed and can be read, but is not searched. Binary and oversized files are skipped. Limits are configuration with safe defaults.
- A plain Markdown document is listed under its front-matter `title` and `description` when it has them; otherwise its title is its first level-one heading, and its description is the first paragraph after that heading (or the first paragraph of the document when there is no heading), shortened to 200 characters. Links become their text; badges, images, lists, quotes, tables and code are skipped on the way.
- **A manifest that cannot be read is reported, never dropped in silence.** Its path, code and reason appear in diagnostics in the [REST API](rest.md), the page of the address and the [tools](tools.md). Its boundary survives parsing, size and indexing failures: a failure must not restore broader default discovery. Before pushing, `check` reads a working tree with the same indexer and prints the findings ([the check role](#checking-a-repository-before-pushing)).
- Repos whose owner has verified them with the service are **verified**; until owners can, the operator of a deployment lists the repositories it vouches for. Responses from every other repository carry a provenance notice ([tools](tools.md)).

## Front-matter

| Field | Required | Rule |
|---|---|---|
| `name` | yes | 1 to 64 characters on one line. |
| `description` | yes | Nonempty text. Authors follow the Agent Skills limit of 1024 characters; the reader preserves longer descriptions with a warning within the front-matter size bound. What the skill does and when to use it; this is what `search` ranks first. |
| `license` | no | Short text. |
| `compatibility` | no | 1 to 500 characters. |
| `allowed-tools` | no | Text, passed through. |
| `metadata` | no | Mapping from short text keys to short text values. |
| `skillcdn` | no | A mapping with what SkillCDN adds to the layout, so that the top level stays the specification's: `include` and `translations`, below. |
| `skillcdn.include` | no | A sequence of at most 20 paths, relative to the skill directory, of Markdown or JSON files the skill needs on every run. `get_skill` returns their text through bounded context pages ([tools](tools.md)). Hidden files may be explicitly included. Paths leaving the skill directory and other file types are dropped and reported. |
| `skillcdn.translations` | no | A mapping from a language tag (`ko`, `pt-BR`) to a mapping with `title` (1 to 200 characters on one line) and `description` (1 to 1024 characters), for people who read the page of the address in that language. At most 32 languages; an entry that translates nothing usable is dropped and reported. These are display text, not search aliases or agent context. Agents read the original `name`, `description` and body. |

- A manifest that breaks a rule for a required field, has no front-matter, or has front-matter that is not valid YAML is **skipped and reported**. It never fails the whole repo. The file stays readable, so that the author can see what was found; it is listed and searched only where a document would be.
- A `name` that ignores the naming convention (lowercase letters, digits and single hyphens) or differs from its directory name is **served with a warning**. The directory rule does not apply to a manifest at the mounted root.
- An optional field that cannot be used is ignored with a warning. Unknown fields are ignored silently, so the convention can grow.
- Two skills may share a `name`; the exact repository-root `SKILL.md` path identifies a skill.

### Writing the values

The front-matter is YAML, and a sentence written as a plain (unquoted) value can mean something else to YAML than to its author. The three mistakes that matter, and what the report says about them:

| Written | What YAML reads | The report |
|---|---|---|
| `description: Makes a video: fast and cheap.` | A nested mapping: a colon followed by a space splits a plain value. The front-matter is invalid and the skill is **skipped**. | `invalid_front_matter`, with the hint that the value of `description` contains `: `. |
| `description: Greets people # by name` | `Greets people`: a space followed by a hash starts a comment. The skill is served with **half its description**. | The warning `commented_value`. |
| `description: [x] Marks the task done.` | A sequence, or an error: `[`, `{`, `&`, `*`, `!`, `%`, `@` and `` ` `` mean something at the start of a value. | `invalid_front_matter`, with the hint that the value starts with that character. |

Quote such a value (`description: "Makes a video: fast and cheap."`) or write it as a block scalar, which takes any text:

```yaml
description: >
  Makes a video: fast and cheap. Use when the user wants a promo
  short for their product.
```

## The format

The reading rules say what is served. The format says how to make it useful: an agent browses folders or searches descriptions, loads an exact skill with `get_skill`, follows its continuation until complete, and reads optional references with `read_file`. A person opens the page of the address and browses the same structure.

### Required

A repository is in the SkillCDN Format when all of these hold. They are what the explorer checks and what the reference repository's own check enforces.

1. **Every skill directory has a `SKILL.md`** whose front-matter passes the table above, whose `name` follows the naming convention and equals the directory name, and whose body starts with a level-one heading.
2. **The `description` says what the skill does and when to use it**, in the words a user would say. It is what `search` ranks first. Say when another skill is a better choice when their purposes overlap.
3. **References make dependencies explicit.** Use Markdown links for repository files needed by the workflow. Shared `.md` references outside the skill work through a repository-root connection. A sub-path connection cannot read references outside its mount; keep a skill self-contained when it must also work alone.
4. **Everything an agent must read is Markdown or small JSON.** Other files are listed and readable, never searched; rendered media and binaries are not part of a skill.
5. **Nothing has to run.** A skill works from its `SKILL.md` and the documents it points to. Scripts may be shipped as help for agents that run locally, and are served as text.
6. **Shared rules have a `SKILLCDN.md` at their scope.** A root manifest states repository-wide rules; nested manifests add rules for their descendants. A manifest is optional when the repository needs no extra metadata, rules, document roots or exclusions. README introductions are available separately and do not become shared rules.
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

A file that every run needs is declared in `skillcdn.include`, so that it arrives through the skill's context pages; a file that only some phase needs is linked from that phase and read when the phase comes.

Keep the skill body and always-required includes modest: about 16 KiB of UTF-8 text combined is a useful authoring target before inherited rules. This is guidance, not an admission limit. Larger context is paged; inherited rules and response metadata also take space. Link optional material from the phase that needs it so agents can read it on demand ([loading a skill](tools.md#loading-a-skill)).

Write the canonical `name`, `description`, body and shared rules in English by default, so agents use the same original across UI languages. Other original languages are supported; declare the language in the nearest applicable manifest. SkillCDN preserves the author's original and never chooses an agent's skill language from the visitor's UI language.

Use `skillcdn.translations` (a title and description) and the manifest's `translations` for people reading the page in another language. Translations are display-only: the explorer marks translated skill summaries, and search uses original metadata and body text rather than translation fields. The original name remains visible beside a translated skill title. MCP discovery and skill context use the original fields and body; reading an exact source file can still show its translation declarations as written.

Connect the repository root by default, so one connection can reach shared references and different areas of work. Both `<area>/skills/<name>/` and `skills/<area>/<name>/` are supported without hiding the `skills` segment. Put a `SKILLCDN.md` where common descriptions and rules belong. Describe who should use that folder's skills and for which tasks. Users may express a preferred area in their client instructions or request; SkillCDN does not remember a selected role.

Plain documents (a document set is a directory of Markdown without a `SKILL.md`) carry a front-matter `title` and `description`, or start with a level-one heading followed by one summary paragraph, because that is what search shows.

### A repository without a manifest

A client is told the repository, commit and mounted path, with a bounded folder overview ([tools](tools.md)). README summaries provide orientation without loading the introduction; the git-host description is the fallback when no local description is available. Valid skills are discovered at any depth, documents in root `docs` are independently discoverable, and local Markdown references can add readable files. The folder tree needs no inferred aliases. A repository adds manifests only where metadata, common rules, other document roots or exclusions are useful.

### README introductions

A README at the repository root or in a directory already exposed through skills, documents or their ancestors can be read with `read_file`. A README alone does not expose an unrelated hidden folder or make every folder in a repository discoverable. The same size, text, symlink, mount and exclusion rules apply as for other files.

The basename is `README` without a language suffix, matched case-insensitively, and the extension is `.md`, `.markdown` or `.mdx`. Choose one overview per directory: exact `README.md`, then `readme.md`, then other `.md` spellings, `.markdown`, and `.mdx`, with lexical order breaking ties. The canonical path preserves the file's actual spelling.

`browse` returns the current folder's optional `overview` with its canonical path, title and short description, and can identify a child folder's `overviewPath`. Titles and summaries use the normal Markdown summary parser. The manifest's explicit name and description take precedence when describing its folder; a README summary fills a missing introduction, followed by the git-host description for the repository root. Reading the overview remains optional: its body is never appended to connection instructions, inherited rules or a skill's required context.

The selected README is the original, without choosing a language variant from the UI language. Authors should write this original in English by default and link human-facing translations themselves. Reading an exact eligible translation path still returns that file as written.

Overview-only files stay out of independent search and document counts. A README independently eligible as a document or supporting file keeps that eligibility. Its local Markdown links follow the ordinary bounded reference rules below, allowing an agent to read a relevant linked guide on demand.

### The repository manifest: `SKILLCDN.md`

A file named exactly `SKILLCDN.md` supplies metadata for its folder and a Markdown body with rules for descendant skills. Manifests may be nested; they do not make isolated projects ([ADR-0022](../adr/0022-repository-paths-and-progressive-skill-loading.md)). They use the same safe front-matter parser and limits as `SKILL.md`.

```markdown
---
name: SkillCDN skills
description: Skills for everyday work, one folder per area (marketing, product, engineering, and more as they are added), served live through SkillCDN. Use to run a skill that drives a tool for a task in one of these areas, or to see how a skill repository in the SkillCDN Format is written.
documents:
  - docs
language: en
translations:
  ko:
    name: SkillCDN 스킬
    description: 업무 분야별 폴더(마케팅, 기획, 개발, 그리고 앞으로 추가될 분야)로 정리된 일상 업무용 스킬 모음입니다. SkillCDN을 통해 실시간으로 제공됩니다. 각 분야의 도구를 다루는 스킬을 실행하거나, SkillCDN 포맷의 스킬 저장소가 어떻게 쓰이는지 볼 때 쓰세요.
license: MIT
metadata:
  author: skillcdn
---
# Rules for every skill in this repository

**Ask only what cannot be derived.** A skill asks for the inputs it cannot get from the request, in one short message, and derives everything else from those inputs and sensible defaults.

**Spend only with consent.** Anything that costs the user money or credits is estimated first and started only after they agree.

...
```

| Field | Required | Rule |
|---|---|---|
| `name` | no | 1 to 100 characters on one line. Default: the repository's name on the git host. |
| `description` | yes | 1 to 1024 characters. Who should use the skills in this folder and for which tasks. Shown with the folder and in connection context when space permits. |
| `documents` | no | At most 20 directories relative to the manifest (`docs`, `docs/` or `.` for its own directory), no `..`; invalid entries are dropped and reported. Their Markdown and JSON are discoverable, and their eligible text files can be read. Default: `docs` next to the manifest. An empty sequence disables bulk document discovery; it does not block explicit file references. An explicitly named hidden directory is allowed. |
| `exclude` | no | At most 100 exact file or subtree paths relative to this manifest; `.` excludes its entire scope. Omitted or empty: no exclusions. A trailing `/` is allowed. No globs, negation, absolute paths or `..`. Ancestor exclusions accumulate and cannot be overridden. Any invalid entry fails the manifest closed rather than silently dropping the policy. |
| `language` | no | The tag of the language the original content is written in (`en`, `ko`, `pt-BR`); English is the recommended authoring default. Told to the client on connect, so that a model searches in that language; on the page, text shown as the author wrote it is marked as being in it. It does not select a translation. A tag that is not one is ignored and reported. |
| `translations` | no | A mapping from a language tag to a mapping with `name` (1 to 100 characters on one line) and `description` (1 to 1024 characters): display text for people reading the page in that language. At most 32 languages. These are not search aliases or agent context; agents read the original `name`, `description` and rules. |
| `license` | no | Short text, as in `SKILL.md`. |
| `metadata` | no | Mapping from short text keys to short text values, as in `SKILL.md`. |

The values are YAML, with the same pitfalls as in `SKILL.md` ([writing the values](#writing-the-values)).

The nearest manifest determines bulk document discovery for a file outside skills. Its `documents` declaration replaces the default at that scope; document directories are not accumulated from ancestors. A manifest itself is readable but not an independent search result.

Rules are different: `get_skill` returns every ancestor manifest's body in root-to-nearest order, labeled by canonical source path, before the skill body. Only `language` automatically inherits among metadata fields, with a nearer declaration overriding it. Names, descriptions, translations, licenses and metadata remain attached to the manifest that declares them.

A failed manifest retains its boundary and is reported. Its descendant scope is closed to discovery and reads because its publication policy could not be established. Neither nested declarations, includes, README overviews nor links reopen it. The policy's diagnostic identifies the problem without exposing descendants. Manifests are considered even under hidden ancestors so exclusions can govern hidden skills. While indexing is incomplete, reads report indexing rather than guessing the policy.

A sub-path connection retains applicable ancestor rules through `get_skill` continuation, but ordinary `read_file` cannot read outside the mount. All source paths remain repository-root paths.

### Excluding files and subtrees

Place the policy at the narrowest relevant scope. For example, to keep test repositories out of a repository's served skills, add this `SKILLCDN.md` inside the directory that contains those fixtures:

```markdown
---
description: Internal test repositories.
exclude:
  - .
---
```

To omit only some descendants, name their paths instead, such as `templates` or `references/draft.md`. Exclusions match complete path segments, so `templates` does not exclude `templates-public`. They use repository path spelling and never escape the manifest directory. A sub-path connection inside an excluded subtree does not bypass an ancestor's policy.

Exclusions govern the served set before parsing descendant skills and walking references. Intentionally excluded fixtures therefore produce neither skills nor irrelevant manifest diagnostics. This is publication control within SkillCDN, not confidentiality: files in a public git repository remain public on the git host.

### Markdown references

The index resolves local Markdown links from valid skills, applicable rules, README overviews and served Markdown documents, recursively following targets ending in `.md`. Inline and reference-style links are supported. Relative links are resolved against their source file; a leading `/` means the repository root. Fragments are removed. External URLs, directory links and anchor-only links are not repository file references. A filename mentioned only in prose or code is not a declaration.

Every resolved target remains inside the repository and refers to the same commit. Normalized paths prevent traversal; symlinks and submodules are not followed. A visited set prevents cycles, and file, byte and traversal limits bound the work. Excluded paths and failed manifest scopes block expansion. A link to another skill or manifest preserves that file's identity and does not make its rules apply to the source skill.

Reference inspection reads at most 262,144 characters and records at most 200 local destinations per source file. Expansion follows at most eight edges beyond already served content, within the repository's file and byte budgets. Hitting these limits marks the index partial; per-file inspection limits also produce a diagnostic.

An otherwise undiscovered target becomes readable, including a hidden file explicitly named by a link. It does not become an independent searchable document, expose siblings or declare another folder's content. Canonical reference paths are returned with the skill for reading when needed.

The served set and reference graph are computed once per repository and commit. A sub-path mount clips the result to its path; it does not recompute graph reachability from local sources. References outside that mount cannot be read there. Repository-root connections can use shared reference directories without copying their contents into every skill.

## Checking a repository before pushing

The server image has a `check` role that reads a directory as the indexer reads a commit, with the same parsers and the same limits, and prints what an agent would get: the manifest, every skill with its files and warnings, the documents outside the skills, linked references, what is not served, index diagnostics, and the instructions a client is told on connect. It needs no database and no git host, executes nothing from the directory, and exits with `1` when index diagnostics are present, so it can gate a push.

```sh
pnpm --filter @skillcdn/server run start check ../skills      # from a checkout of this repository
node dist/main.js check /path/to/repository                    # from the image
```

The working-tree reader does not follow symbolic links and excludes repository administration and dependency directories. Hidden content otherwise follows the same declarations as indexing. It reads a working directory rather than a commit, so untracked or ignored files can make its report differ from what was pushed. Only the `INDEX_*` limits are read from the environment ([deploy](../../deploy/README.md)).

## Parsing requirements

Everything in a repo is untrusted input:

- YAML is parsed with the failsafe schema: strings, mappings and sequences only, so `1.0` and `no` stay the text the author typed. Explicit tags, aliases, duplicate keys, non-string keys and a second document are errors. Front-matter is at most 16,384 characters and a manifest at most 262,144.
- Front-matter fields are validated against the table above. Text that carries control or invisible characters is rejected, never cleaned up.
- Paths from manifests must stay within their declared repository scope. Canonical paths returned to clients are repository-root paths. Symlinks are not followed.
- Markdown links are parsed as data, normalized and checked before bounded local reference expansion. They never cause a network fetch to a linked URL or execute repository code.

## Open questions

- The exact rules for *verified* once owners can verify a repository themselves; the operator's list is a stand-in.
- How `intake` questions are declared.
- How skills that need user files describe an upload step, given that remote MCP servers cannot receive chat attachments.
- Whether the explorer reports the format's required points 3 to 6 as diagnostics, next to the manifest diagnostics it already reports.
- Search matches words as written. A repository in a language whose words carry particles or inflections (Korean, for one) is found by its exact words; whether `language` should pick a text-search configuration, or a morphological or embedding search should take over, is open.
