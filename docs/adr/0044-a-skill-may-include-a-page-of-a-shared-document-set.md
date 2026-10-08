# ADR-0044: A skill may include a page of a shared document set, served inline

- Status: Accepted
- Date: 2026-10-08
- Amends point 2 of ADR-0018: an include may name a page outside the skill directory.

## Context

The skills of one tool family repeat what they know about the tool: how it behaves, what it refuses, what its models do with the sounds of a language. The reference repository moved that knowledge into one document set at the root and linked it from each skill, which the format allows: a Markdown reference outside the skill is readable through a repository-root connection ([skill-repo.md](../specs/skill-repo.md), "Markdown references"). Three things were left wanting:

1. The pages do not travel with the skill. On a sub-path mount they are outside the mount and unreadable; a host that receives the skill through the skills extension gets a `SKILL.md` whose links point at files that are not among its resources, and such a host cannot call `read_repo_file`; a skill copied from the git host or installed as a plugin has dead links. The skill's Requirements say where to fetch them, which is a sentence an agent must act on.
2. `skillcdn.include` reaches only inside the skill directory ([ADR-0018](0018-skillcdn-fields-in-skill-md-under-one-key.md)), so a shared page that every run needs cannot arrive with the skill the way a local reference does: it costs a `read_repo_file` call per run, where that call can be made at all.
3. Rules a family shares have no manifest to live in when its skills sit in several areas: rules chain by folder ancestry, and a tool family is orthogonal to the folders. Each skill restates them.

## Decision

1. **`skillcdn.include` may name a file outside the skill directory.** The path is written as a link destination is: relative to the skill directory, or from the repository root with a leading `/`. Such a path names a shared page when the file is a Markdown or JSON document served under a document directory declared by the manifest that governs it (the root's `docs` where no manifest governs), and that manifest is at or above the skill, as the manifests whose rules the skill carries are. Anything else (a sibling area's page, another skill's file, an excluded or hidden file, a file only a link reaches) is dropped and reported; an include outside the skill directory publishes nothing.
2. **A shared page is inlined like a local include.** `load_skill` and the assembled `SKILL.md` carry it under `--- included file: <repository-root path> ---`, in declaration order with the skill's own includes; the digest covers it, so a change to the page changes the digest of every skill that includes it, as a change to a manifest does. The index stores every include as a repository-root path.
3. **It is delivered on every route the skill is.** On a sub-path mount a shared page arrives with the skill's context, as ancestor rules do, although `read_repo_file` still cannot read it by its path outside the mount. The skills extension does not list it among the skill's `resources`, which are the files of the skill directory; the assembled `SKILL.md` carries its text, and the line that names the sources names its path. The page remains a document of the repository in its own right, listed and searched where it is.
4. **A copy taken from the git host must fetch it.** The source `SKILL.md` keeps the include path, which is the page's path in the repository, and `check` prints the shared pages of each skill apart from its own files, so that an author sees what a bare copy lacks.

## Consequences

- A tool family keeps one copy of what its skills share, and every skill still arrives whole wherever SkillCDN serves it; the rules a family shares can be one included page.
- A skill that includes a shared page grows by that page on every load; the 16 KiB authoring target applies to the sum, so what every run needs is included and the rest is linked.
- A shared page's digest consequence is new to authors: editing it re-asks every host that verified a skill including it. The reference repository already edits manifests deliberately for the same reason.
- The reading rules carry a new version: includes stored relative to the skill directory are rebuilt as repository-root paths.
- Rejected: a manifest per tool family (rules chain by ancestry, and a family spans areas); symbolic links to the shared page inside each skill (not followed); copying the page into every skill at serve time by a build (repositories declare; nothing runs); listing the shared page among the skill's resources (its URI would name a file outside the skill's directory, and two skills would list one file); letting a skill include any served document (what a skill carries comes from its own lineage, the manifests above it and the documents they declare, as its rules do); a warning from `check` on every link that leaves a skill (the format allows such links on purpose, and the choice between a link and an include is the author's).
