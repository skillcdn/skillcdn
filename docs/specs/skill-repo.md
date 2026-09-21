# Spec: skill-repo convention

- Status: **Draft.**
- Implemented by: `packages/core` (`parseSkillManifest`, `classifyRepoFile`, `summarizeMarkdown`). Fixtures live in [`skills/`](../../skills/).

How SkillCDN reads a repository. We follow the [Agent Skills](https://agentskills.io/specification) layout instead of inventing a new one: a repository that already works as a skills folder works here unchanged.

```
repo/
  SKILL.md                  a single-skill repo, or
  skills/
    <name>/SKILL.md         a multi-skill repo; front-matter carries name, description, ...
    <name>/references/      supporting documents the skill points to
  skillcdn.yaml             optional: modules to enable, aliases, intake questions   (TBD)
```

## Rules

- **A skill is a directory that holds a file named exactly `SKILL.md`**, at any depth inside the mounted path. `skills/<name>/SKILL.md` is the usual layout; a `SKILL.md` at the mounted root makes the whole mount one skill. A file belongs to the nearest skill directory above it, so a nested skill owns its own files.
- `SKILL.md` is YAML front-matter followed by a Markdown body. Everything else in the skill directory is a supporting file the body may point to.
- A repo without any skill manifest still works, as a document-reading endpoint: `find` and `read_file` only.
- **Repositories declare; they never ship code that we execute.** Composition ("take this input, call these tools in this order") will be declared in Markdown or YAML. Scripts in a repo are files like any other: readable, never run. `allowed-tools` is passed through as text and grants nothing.
- Indexed content: skill manifests, Markdown (`.md`, `.markdown`, `.mdx`) and small JSON. Every other file is listed and can be read, but is not searched. Binary and oversized files are skipped. Limits are configuration with safe defaults.
- A plain Markdown document is listed under its front-matter `title` and `description` when it has them, otherwise under its first level-one heading.
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

## Parsing requirements

Everything in a repo is untrusted input:

- YAML is parsed with the failsafe schema: strings, mappings and sequences only, so `1.0` and `no` stay the text the author typed. Explicit tags, aliases, duplicate keys, non-string keys and a second document are errors. Front-matter is at most 16,384 characters and a manifest at most 262,144.
- Front-matter fields are validated against the table above. Text that carries control or invisible characters is rejected, never cleaned up.
- Paths from manifests are normalized and must stay inside the mounted root. Symlinks are not followed.
- Links inside Markdown are text. Nothing resolves or follows them on the server.

## Open questions

- How much of `skillcdn.yaml` is needed versus inferred from `SKILL.md` front-matter.
- The exact rules for *verified*, and the wording of the provenance warning.
- How `intake` questions are declared.
- How skills that need user files describe an upload step, given that remote MCP servers cannot receive chat attachments.
