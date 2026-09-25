# ADR-0018: What SkillCDN adds to `SKILL.md` lives under one key: files that come with the skill, and translations

- Status: Accepted; the hidden-file restriction on includes in point 2 is superseded by ADR-0022, and ADR-0025 strips the key from what is served
- Date: 2026-09-23

## Context

The layout of a repository is the Agent Skills layout, and the top level of a `SKILL.md` front-matter belongs to that specification. Two things the specification has no place for turned out to matter in the first real runs ([specs/skill-repo.md](../specs/skill-repo.md)): a skill that points at seven reference files cost seven `read_file` calls on every run, though every run needs them; and a person who reads the page of an address sees the skill's name and description in the one language the author wrote for agents, while the page itself speaks the visitor's language.

## Decision

1. **One key, `skillcdn`, holds what SkillCDN adds to a `SKILL.md`.** Other readers of the layout ignore it, as they ignore any field they do not know, and the top level stays the specification's. The repository manifest is SkillCDN's own file, so its additions stay at its top level.
2. **`skillcdn.include` names the files a skill needs on every run**, relative to its directory, Markdown or JSON only, at most twenty. `get` returns their text with the skill, after the instructions, within one size limit for all of them; `read_file` has what was cut. Which files every run needs is the author's knowledge, so the author declares it; the other files stay linked from the phase that needs them, and are read when it comes.
3. **Translations are the author's, next to what they translate.** `skillcdn.translations` in a skill carries a `title` and a `description` per language tag; `translations` in the repository manifest carries a `name` and a `description`; the manifest may say which `language` the repository is written in. Agents always read the original `name` and `description`: a skill's `name` is an identifier, and what a model is told does not change with the visitor's language. The web UI shows the translation in the visitor's language when there is one, and the original otherwise.

## Consequences

- One `get` replaces a call per file for a skill that declares its files, at the cost of a larger result; the limit keeps it bounded. The index stores the list, so the reading rules carry a new version and older indexes are rebuilt.
- A translation is a few lines in the file it belongs to, versioned with it, and mounted with it when the skill is mounted alone. It costs nothing when absent.
- Rejected: inlining every supporting file below a size (the case at hand was over any sensible size, and an agent reading a fragment of a large skill would pay for all of it); a tool argument that asks for the files (the model would have to know before reading the instructions, and the round trip is what was to be saved); translated names (a name is what `get` takes); a translated `SKILL.md` per language (the body is for agents, in one language); translations in a separate file or in the manifest (away from what they translate, and lost when the skill is mounted alone).
