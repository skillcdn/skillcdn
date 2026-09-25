# ADR-0024: Skills travel through the MCP skills extension; the tools discover

- Status: Accepted
- Date: 2026-09-26
- Supersedes the tool names in point 2 of ADR-0022 and the listing of skills under hidden ancestors in its point 4. The rest of ADR-0022 stands.

## Context

The MCP skills extension (`io.modelcontextprotocol/skills`, SEP-2640, final since 2026-09-13) is how a host that understands skills discovers them: it lists them with `skills/list`, fetches one with `skills/get`, reads their files as resources, verifies every file against the digest and size the listing declared, and binds the user's approval to that content. To such a host, a server that offers skills only through tools of its own offers no skills at all. The extension is written for the current, stateless protocol revision, delegates the file format to Agent Skills, allows a partial listing, and bounds a skill to 512 files and 16 MiB.

Nothing of the MCP surface is deployed for real yet, so the surface can change once more without a compatibility period. After that it must not.

## Decision

1. **The extension is the channel for skills.** A mount declares `io.modelcontextprotocol/skills` with directory reads. `skills/list` pages through the skills the mount serves, `skills/get` answers for every one of them, `resources/read` serves every file of a listed skill, and `resources/directory/read` lists a skill directory; `resources/list` lists the `SKILL.md` resources and nothing else. List and read results carry a `ttlMs` of what remains of the ref resolution's life and a `cacheScope` that follows the repository's visibility. Everything is served from the same index, under the same publication policy, exclusions and limits as the tools.
2. **A skill URI mirrors the address without its ref.** A file of a skill is `skill://gh/<owner>/<repo>/<path>`, where `<path>` is its repository-root path; a root-level `SKILL.md` takes the skill's name as its directory segment, `skill://gh/<owner>/<repo>/<name>/SKILL.md`. The URI names the file and the address names the commit: no ref or commit appears in a URI, and the digest in the listing binds the two.
3. **The tools stay, as discovery and as the path for hosts without the extension.** `browse_repo` lists a folder, `search_repo` searches, `load_skill` assembles a skill and `read_repo_file` reads a file; `use_skill` remains the one prompt. The names say what they act on, so that they do not collide with a host's own tools. Same index, same budgets and same results as under the earlier names.
4. **Identical skills are listed once, and hidden ones only when nothing else is there.** Copies of a skill under per-agent hidden directories, identical file for file, are listed at the visible or else the shortest path. Hidden directories contribute other skills to listings and search only when the repository has no visible skill. Every declared skill stays loadable by its exact path.
5. **From here on, changes are additive.** Tool names and schemas, URIs and the extension surface change only by addition unless an ADR defines a breaking transition. This is the last pre-alpha replacement.

## Consequences

- A host with the extension sees skills as skills: verified, approved once per content, namespaced per server. A host without it works as before, through the tools. Connection instructions name the skills by URI as well as by path.
- The index has to hold what the listing declares: the bytes of every served file with their SHA-256 digests, and the assembled `SKILL.md` ([ADR-0025](0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)). A commit is listed only once its index is complete.
- A change to a root manifest changes the digest of every skill below it, so hosts ask their users again. That is the price of rules that travel with the skill.
- Rejected: skills as tools only (invisible to hosts that implement the extension, which exists because tool-based serving was found wanting); a URI that carries the commit (a pinned address already names it, and a host that keys identity on the URI would see a new skill at every push); listing every hidden copy (the same skill several times in a menu); dropping the tools (search and folder browsing over hundreds of skills are what a partial listing cannot give).
