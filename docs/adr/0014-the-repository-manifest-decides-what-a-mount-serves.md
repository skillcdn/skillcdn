# ADR-0014: A repository manifest names the repository and decides what a mount serves

- Status: Accepted
- Date: 2026-09-22

## Context

A repository had no way to say what it is: a mount was named by its address and described by whatever its git host showed. Every file in the tree was listed and every Markdown or JSON file was searched, tooling included, so an agent saw check scripts and contributor documentation next to the skills. Rules that hold for every skill of a repository had to be repeated in each skill, because a skill may be served alone. The Agent Skills layout has nothing at the repository level, so whatever fills the gap is ours to define ([specs/skill-repo.md](../specs/skill-repo.md)).

## Decision

1. **`SKILLCDN.md` is the repository manifest**: a file with exactly that name, YAML front-matter and a Markdown body, read with the parser and the limits of `SKILL.md`. The front-matter carries `name`, `description`, `documents`, `license` and `metadata`; the body carries the rules that hold for every skill. It is the repository's counterpart of `SKILL.md`, and it is readable as a document by anything else.
2. **With a manifest, only what is declared is served.** A mount under a manifest serves its skills, the directories the manifest declares, and the manifest itself. Everything else is known to the index and served by nothing: not listed, not searched, not readable, and outside any later index. A manifest that cannot be read fails closed: it is reported, and the mount serves its skills and the manifest only. Without a manifest a repository is served as before, hidden entries excepted.
3. **The manifest governs the mounted directory and everything below it, from the nearest directory at or above the mount.** A sub-path mount of a monorepo inherits the repository's manifest; a directory with a manifest of its own is a project of its own. What the manifest says reaches the client everywhere: the server instructions and the server info carry the name and the description, `get` and the skill's prompt return the rules before the skill, the page of the address shows the name and the description, and the connection guide uses the name.
4. **Hidden entries stay hidden** whatever the manifest says: any path segment that starts with a dot is tooling, not content.

## Consequences

- A repository author controls what an agent sees with one file, in the format they already write, and states shared rules once.
- The index stores every file of the tree with a visibility flag, so the served set is decided once per commit and every query filters on it. While a commit is being indexed nothing has read its manifests, so under one only the skills and the manifests are readable until the index is there.
- The counts and listings a client sees exclude what the manifest leaves out; a repository that adds a manifest changes what its address serves.
- Rejected: a separate ignore file in gitignore syntax (a parser of its own, and a second place to look); reading `export-ignore` from `.gitattributes` (the index reads the tree, not an archive, and the attribute means something else); serving the rules as a prompt of their own (a client that shows prompts as commands would offer rules as a command, and a skill would still arrive without them).
