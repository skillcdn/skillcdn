# Spec: skill-repo convention

- Status: **Draft.**
- Implemented by: `packages/core` (convention parser). Fixtures live in [`skills/`](../../skills/).

How SkillCDN reads a repository. We follow the existing Agent Skills layout as closely as possible instead of inventing a new one.

```
repo/
  SKILL.md                  a single-skill repo, or
  skills/
    <name>/SKILL.md         a multi-skill repo; front-matter carries name, description, ...
    <name>/references/      supporting documents the skill points to
  skillcdn.yaml             optional: modules to enable, aliases, intake questions   (TBD)
```

## Rules

- A skill is a `SKILL.md` with YAML front-matter (at least `name` and `description`) and a Markdown body, plus any reference documents it links to.
- A repo without any skill manifest still works, as a document-reading endpoint: `find` and `read_file` only.
- **Repositories declare; they never ship code that we execute.** Composition ("take this input, call these tools in this order") will be declared in Markdown or YAML. Scripts in a repo are files like any other: readable, never run.
- Indexed content: Markdown, small JSON and skill manifests. Other text formats follow as needed. Binary and oversized files are skipped. Limits are configuration with safe defaults.
- Repos where the GitHub App is installed are **verified**. Responses from unverified repos carry a provenance warning.

## Parsing requirements

Everything in a repo is untrusted input:

- YAML is parsed with a safe schema, with limits on size, depth and alias expansion.
- Front-matter fields are validated against a schema. Unknown fields are ignored, not errors, so the convention can grow.
- Paths from manifests are normalized and must stay inside the mounted root. Symlinks are not followed.
- A malformed skill is reported as such and skipped. It never fails the whole repo.

## Open questions

- How much of `skillcdn.yaml` is needed versus inferred from `SKILL.md` front-matter.
- The exact rules for *verified*, and the wording of the provenance warning.
- How `intake` questions are declared.
- How skills that need user files describe an upload step, given that remote MCP servers cannot receive chat attachments.
