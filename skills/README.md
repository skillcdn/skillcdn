# skills/

Reference skill repositories that the [SkillCDN Format](../docs/specs/skill-repo.md) reader is tested against. They are **product content**: fixtures for tests, and small illustrations for documentation. They are not tooling for the agents that work on this codebase; that lives under `.claude/`.

| Directory | What it is |
|---|---|
| `single-skill/` | One `SKILL.md` at the repository root, with a reference document. |
| `multi-skill/` | Two skills under `skills/`, plus ordinary documents, a JSON asset and a script that is only ever read. |
| `hostile/` | Broken manifests next to a valid one. Each broken skill is skipped and reported; the rest is still served. |

## Rules

- One directory per reference repo, laid out exactly as a real repository root would be, so the same fixture serves parser tests, indexer tests and docs.
- Keep a deliberately broken set as well (malformed front-matter, path traversal attempts, oversized files). Hostile fixtures are as valuable as valid ones.
- Content here is public and illustrative. No real customer material and no secrets, even fake-looking ones that would trip the secret scanner.
- Realistic examples live in the separate `skillcdn/examples` repository, the reference repository of the format and the one the explorer offers to try. Nothing here is shown as an example to visitors.
