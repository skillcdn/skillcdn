# Spec: tools exposed to the agent

- Status: **Draft.**
- Contracts (names, input and output schemas) live in `packages/core`; handlers live in `apps/server`.

Most MCP clients do not load tools lazily, so SkillCDN does not expose one tool per skill. A mounted address exposes a small, fixed set of meta tools and the model picks from there.

| Tool | Purpose | Milestone |
|---|---|---|
| `find` | Natural-language or keyword search over skill descriptions and documents in the mounted repo. PostgreSQL full-text search first; embeddings later if needed. | 1 |
| `get` | Return a skill or playbook by name, with its front-matter and body. | 1 |
| `read_file` | Read a file inside the mounted ref and path. Markdown first; other text formats as we go. | 1 |
| `intake` | Run the intake questions a skill declares, so a non-expert can be walked through it. | later |
| `describe` / `run` | Schema and execution for composed tools declared in Markdown or YAML. | later |

## Rules

- **The tool set is a public contract.** Agents in the wild depend on names and schemas. Changes are additive; a breaking change needs an ADR and a deprecation path.
- Tools operate strictly inside the mounted `(repo, ref, path)`. No tool can reach another repo or escape the mounted path.
- Output is data for the model: text and structured fields. No tool returns anything that is executed on the server or on the user's machine.
- Responses from unverified repos include the provenance warning defined in the [skill-repo convention](skill-repo.md).
- Every tool call passes the permission check for the mounted repo. For private repos there are no exceptions, including cached results.
- Errors are typed and safe: they never reveal whether a private repo exists.

## Open questions

- Whether unverified public repos get `find` at all, or only `read_file`.
- Result shape and ranking for `find`: snippet length, how many results, how skills rank against plain documents.
- Size limits and pagination for `read_file`.
- What a tool call returns while the commit is still being indexed.
