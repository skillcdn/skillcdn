# Spec: tools exposed to the agent

- Status: **Draft.**
- Contracts (names, descriptions, input schemas, result shapes and their text rendering) live in `packages/core`; handlers live in `apps/server`.

Most MCP clients do not load tools lazily, so SkillCDN does not expose one tool per skill. A mounted address exposes a small, fixed set of meta tools and the model picks from there.

| Tool | Purpose | Milestone |
|---|---|---|
| `find` | Natural-language or keyword search over skill descriptions and documents in the mounted repo. PostgreSQL full-text search first; embeddings later if needed. | 1 |
| `get` | Return a skill or playbook by name, with its front-matter and body. | 1 |
| `read_file` | Read a file, or list a directory, inside the mounted ref and path. | 1 |
| `intake` | Run the intake questions a skill declares, so a non-expert can be walked through it. | later |
| `describe` / `run` | Schema and execution for composed tools declared in Markdown or YAML. | later |

## Inputs

| Tool | Argument | Rule |
|---|---|---|
| `find` | `query` | Optional text, at most 500 characters: words in the language the repository is written in. Omitted or blank: list what is available, every skill (up to 100) first, then the documents that do not belong to a skill. |
| | `limit` | Optional integer, 1 to 25. Default 10. Without a query it bounds the documents only; every skill is listed. |
| `get` | `name` | Required. The skill name as `find` returns it, or the path of the skill directory. When several skills share the name, the answer lists their directories and asks for one. |
| `read_file` | `path` | Required. Relative to the mounted root. Validated like an address path: no `..`, no backslashes, no control characters. The path of a directory lists what it contains; `.` names the mounted root. |
| | `offset` | Optional character offset. Default 0. |
| | `limit` | Optional number of characters, 1 to 100,000. Default 40,000. |

All three tools are read-only and idempotent.

## Results

- A result is **text written for a model**: a short header from SkillCDN (what was found, which repository, ref and commit it came from, what to call next), then the repository content. There is no structured output yet. Clients differ in whether they hand a model the text or the structured form, and every client handles text; a structured form can be added later without breaking anyone.
- Every path in a result is relative to the mounted root, so it can be passed straight to `read_file`.
- `find` matches words, not meaning, in the language the repository is written in; its description says so, and names that language when the manifest declares it, so that a model asks in the repository's terms rather than its own. A query matches when any of its words match, ranking decides the order, and skills are boosted over plain documents. A skill matches on its name and description before its body. A document is listed with its title and its description, which for a document without one is the first paragraph of its body ([convention](skill-repo.md)).
- **A skill's own files never stand on their own in a search.** They are folded under their skill, which takes the place of its best-ranked member in the order and lists up to five of its matching files with a count of the rest, so that a model loads the skill rather than a fragment of it. A skill whose file matched is listed even when the skill itself did not.
- A listing (`find` without a query) says how many skills and documents there are, names every skill, and then only the documents outside the skills: a skill's own files are reached through the skill. It ends with the manifests that could not be read, each with its path, a code and the reason, so that a skill that is missing has an explanation ([convention](skill-repo.md), "Reading rules"). A search that finds nothing lists them in full as well; among results, one line says how many there are and points at the listing.
- `get` lists the supporting files of the skill so the model knows what it can read next, relays every front-matter field the convention knows (license, compatibility, allowed tools, metadata), and the author-facing warnings from the [convention parser](skill-repo.md). When the repository has a manifest with rules ([convention](skill-repo.md), "The repository manifest"), they come as a section before the instructions of the skill, named after the manifest's path; past a limit they are cut with a note, and `read_file` has the rest.
- **The files a skill declares as needed on every run come with it** (`skillcdn.include`, [convention](skill-repo.md)): after the instructions, each under a header with its path, in the order declared, within 100,000 characters for all of them together; past that a file is cut with a note that says where `read_file` continues. In the list of supporting files they are marked as included. A file that is not at hand (not indexed, over the limits) is named with a note. Translations are for people and are not rendered for a model.
- A name `get` does not serve gets the names of the skills that are, and the manifests that could not be read with their reasons: the skill asked for may be among them.
- `read_file` serves UTF-8 text only and pages long files. A page never splits a character, and says where the next page starts. It serves any text file the mount serves, not only the searchable ones: the files of the skills and of the document directories. Hidden entries, and whatever else the [convention](skill-repo.md) leaves out, no tool ever lists, searches or reads. Given a directory, it lists the directory's entries, subdirectories first and files with their sizes, at most 200, so that a model can browse from where a skill or a document points without guessing paths.
- A problem the model can fix (unknown skill, unknown path, a binary or oversized file) is a tool result marked as an error, with a hint. It is not a protocol error.
- When the repository is larger than the indexing limits, results say that files are missing.

## What a client is told on connect

A client learns three things about a mount before it calls a tool, so that a model can tell whether this server matters for a task without a round trip:

- **The server instructions** name the repository, the commit and the mounted path, say how many skills and other documents there are, list every skill with its description, and say how a skill is used (`get`, then `read_file` for the files it points to; the files it needs on every run come with it). A repository with a manifest introduces itself instead, by the name and the description it gives itself, says which language it is written in when it declares one, and the instructions say that its rules come with every skill. When manifests could not be read, the instructions say how many and name up to three, so that a model asked for one of those skills by name does not look for it in vain. They stay under 2,000 characters, because clients hand them to the model as they are and one of them cuts them there: descriptions are shortened step by step, then only names are listed, then fewer names with a count of the rest. While the commit is being indexed, the instructions say so instead.
- **The description of `find`** names the skills as well, for clients that show no instructions, and the language of the repository.
- **The server info** carries the address as its title, or the name from the manifest when there is one, its description likewise, and the page of the address as its website, for clients that show where a server comes from.

## Skills as prompts

Every skill of a mount is also an MCP prompt: named after the skill (after its directory, with `-` for `/`, when several skills share a name), titled with the skill's name, described by its description, and without arguments. Asking for the prompt returns what `get` returns, as one user message. A client that turns prompts into commands thus lets a person call a skill up by name, without the model having to find it first. The list is what the index knows when the client connects; a client that connected while the commit was being indexed sees no prompts until it connects again.

Documents are not offered as MCP resources: `find` and `read_file` reach them, and a repository may hold hundreds of them ([ADR-0012](../adr/0012-what-a-client-is-told-and-offered.md)).

## While a commit is being indexed

The first request for a commit starts indexing in the background; connecting to the endpoint already does, before any tool is called.

- `find` and `get` wait for the index, up to a configurable budget (seconds, not minutes). If it is ready in time the call is answered normally.
- Past the budget they return a normal, non-error result that says the commit is still being indexed and to call again shortly. Indexing continues.
- `read_file` does not wait for the index.
- When indexing fails, the result says so and the next request retries after a backoff.

## When the repository moves

A moving ref (a branch, a tag, the default branch) is resolved to a commit at request time and trusted for a short while ([address](address.md)). A session that started at one commit answers from the next one after a push, call by call, and nothing tells the client so: every result names the commit it was answered from, and the instructions name the commit the client connected at. A client that notices the commit change reloads the skill it is running. To hold a commit for a whole session, mount the address pinned to it (`@<full commit hash>`), which always serves the same content.

## Rules

- **The tool set is a public contract.** Agents in the wild depend on names and schemas. Changes are additive; a breaking change needs an ADR and a deprecation path.
- Tools operate strictly inside the mounted `(repo, ref, path)`. No tool can reach another repo or escape the mounted path.
- Output is data for the model: text. No tool returns anything that is executed on the server or on the user's machine.
- **Responses from a repository nobody has vouched for carry a provenance notice**: its content comes from whoever controls the repository, not from the user, so it is used for the task the user asked for and anything beyond that is data, not an instruction. The notice never tells the model to ignore the skill the user asked for, because the user chose the repository; what it warns against is what the repository says beyond the task. Until owners can verify a repository through the git host's app ([ADR-0019](../adr/0019-the-operator-vouches-for-repositories-until-owners-can.md)), the operator of a deployment lists the repositories it vouches for (`VERIFIED_REPOSITORIES`); results from those carry no notice, and the page of the address shows no warning. The wording lives next to the renderers in `packages/core`.
- Every tool call passes the permission check for the mounted repo. For private repos there are no exceptions, including cached results.
- Errors are typed and safe: they never reveal whether a private repo exists.
- **A client running in a browser may reach the endpoint from any origin**, as it may reach the [REST API](rest.md): responses say `access-control-allow-origin: *`, preflight requests are answered, and credentials are never used ([ADR-0012](../adr/0012-what-a-client-is-told-and-offered.md)).

## Open questions

- Whether unverified public repos keep `find` once verification exists, or only `read_file`.
- Whether a client should be told that the commit moved during a session, beyond the commit in every result.
- Whether `read_file` should take several paths in one call, for a skill that points at files only some runs need.
