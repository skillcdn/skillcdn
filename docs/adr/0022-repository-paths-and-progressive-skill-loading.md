# ADR-0022: Repository paths identify content and skills load progressively

- Status: Accepted
- Date: 2026-09-24
- Supersedes the catalog, prompt and text-only decisions in ADR-0012; the scope and hidden-entry decisions in ADR-0014; the exclusive served-set rule in ADR-0016; and the hidden-file restriction on includes in ADR-0018. The remaining decisions stand.

## Context

A repository can hold skills for several kinds of work, at any depth. A flat catalog does not explain its folders, and names do not uniquely identify skills. Mount-relative paths change a file's spelling between connections. Loading only the mount's manifest loses nested rules; cutting rules loses instructions. Shared references can live outside a skill's folder, including explicitly declared content under hidden directories.

## Decision

1. **Use actual repository-root paths everywhere.** A skill is identified by its exact `SKILL.md` path. Names are display and search metadata. Recommend connecting the repository root; a sub-path mount still limits content access. No shortened paths, directory aliases or implicit role state.
2. **Offer four read-only tools:** `browse` for immediate folder entries, `search` for ranked results, `get_skill` for one exact skill, and `read_file` for raw text. Browse and search have cursors; search folds supporting files before pagination. Results contain text and structured data. One `use_skill(path)` prompt replaces a prompt for every skill.
3. **Preserve the real folder tree.** `SKILLCDN.md` adds a folder's name, description and common rules. Rules accumulate from the repository root to the skill's nearest manifest, with source paths. Only `language` inherits automatically among metadata fields. `get_skill` pages the full rule chain, skill body and included files, in that order. An incomplete page says so and gives a continuation. Ancestor rules remain retrievable through this continuation even above a sub-path mount; this grants no arbitrary file access there.
4. **Separate discovery from readability.** `documents` declares bulk discovery roots, not a denylist. A valid exact `SKILL.md` declares a skill even under hidden ancestors. Ordinary supporting descendants are eligible; additional hidden descendants require an explicit include, document declaration or link. No repository-specific exceptions or additional `skills` field are needed.
5. **Resolve local Markdown references at indexing time.** Skills, rules and served Markdown documents seed a bounded recursive traversal of links to `.md` files in the same repository and commit. Linked-only files are readable references, not independent search results. A file link never exposes siblings or applies another folder's rules. Failed manifests retain their boundaries, including under indexing limits, and block link expansion. Serving is decided per repository and commit; a mount clips the resulting set, rather than rebuilding the reference graph.

## Consequences

The reader preserves descriptions beyond the Agent Skills authoring limit with a warning, within the existing front-matter size bound. This is a general compatibility rule: invalid YAML, missing required text and unsafe characters still fail validation. Authoring guidance keeps the specification's 1024-character description limit.

The pre-alpha MCP and REST contracts change without a compatibility period. This is the explicit exception to additive public-contract changes. Clients use canonical paths and reload their tool definitions. Cursors are bound to the indexed snapshot and reading-rule version, mount and request; a changed request or snapshot requires a restart.

Indexing records reference targets and distinguishes discoverable content from linked-only content. The reading-rule version changes with these semantics. Permissions, symlink rejection, no repository code execution, and bounded parsing remain unchanged. The complete contract lives in [tools](../specs/tools.md), [the format](../specs/skill-repo.md) and [REST](../specs/rest.md).
