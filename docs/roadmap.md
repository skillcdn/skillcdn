# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues; this file stays coarse.

## Done

- **Foundation.** Monorepo layout, pinned toolchain, lint, typecheck and test pipeline, CI, container image with role dispatch, license, contributor and agent documentation.
- **Milestone 1: serve a public repository end to end.** An MCP client connects to `/gh/<owner>/<repo>` for a public GitHub repository and can `find`, `get` and `read_file`: address and skill-repo parsers in `core`, the GitHub adapter, the first schema with full-text search, the `api` and `migrate` roles with lazy indexing, reference skill repos, an end-to-end test with the MCP client SDK, and what the server needs to run behind a reverse proxy. Publishing and deployment are not part of this repository ([ADR-0008](adr/0008-repository-ends-at-an-image-that-builds.md)); the milestone is really over with the first hosted staging deployment.

- **Milestone 2: the web UI.** A person opens the service in a browser, understands what it does in their language, pastes an address and sees what an agent gets from it: REST API v1 ([specs/rest.md](specs/rest.md)); the landing page and the explorer in English and Korean, prerendered per language with metadata, structured data, social-preview images and `llms.txt` ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md)), with the design decided with the maintainers (a restrained developer-tool look, one blue accent, dark only, a placeholder symbol until there is a logo); the server serves the build, renders the page of an address with its data so that it can be indexed, and generates `sitemap.xml` and `robots.txt` ([ADR-0011](adr/0011-address-pages-rendered-on-the-server.md)); the UI runs on its own for whoever designs it, from fixtures or against a running server; usage statistics per public repository and skill, and distinct clients counted without identifying one ([ADR-0010](adr/0010-distinct-clients-by-daily-keyed-hash.md)); search-console and analytics tags from configuration. Login and repository connection arrive with private repositories.

## Now: milestone 3, MCP in depth

Goal: an agent that connects to an address knows what it got and uses it well, whatever the client; a person who opens the page of a repository connects their agent from there.

- [x] What a client is told on connect: the catalog of skills in the server instructions and in the description of `find`, the address in the server info ([ADR-0012](adr/0012-what-a-client-is-told-and-offered.md))
- [x] `find` without a query lists every skill and leaves a skill's own files to the skill; a document without a description is summarized by its first paragraph
- [x] `get` relays every front-matter field; `read_file` lists a directory
- [x] Every skill is an MCP prompt; documents are not resources
- [x] The MCP endpoint answers browsers on any origin, as the REST API does
- [x] The page of a repository leads with its name and description, then the steps to connect it to the common clients, and shows what the agent is told when it connects
- [x] Hidden entries (any path segment that starts with a dot) are never listed, searched or read
- [ ] The repository manifest `SKILLCDN.md`: name, description, the directories whose documents are served, and the rules that hold for every skill; with a manifest, only what it declares is indexed, now and by any later index. The proposal is in [specs/skill-repo.md](specs/skill-repo.md) and is decided before it is built.
- [ ] Connect real clients by hand, to a local server and to the hosted service, and fix what they show. Nothing in this repository can test that; it is done after every change to what a client sees.

Design points still open (record the outcome in the spec or an ADR):

- Pinned commits that the host serves through a repository without being part of its history (see the open questions in the address spec).
- Abuse controls for the anonymous endpoints. The server bounds its own work: request and index size limits, bounded indexing per process, a short in-process memory of names that do not exist. Limiting requests per client is the job of whatever sits in front of the server. Still missing here: a negative cache shared between replicas.
- A structured result form next to the text of tool results, when a client needs one.

## Next

1. User documentation: how to write a skill repository and how to use one from an agent. Written for repository authors and the people who use their repositories, not as a description of internals. One source: every topic lives in exactly one Markdown file in this repository, the published documentation is rendered from those files, and everything else links to them instead of repeating them. How it is published is decided when the work starts. The format a repository follows is specified as the SkillCDN Format in [specs/skill-repo.md](specs/skill-repo.md); `skillcdn/examples` is its reference repository, the one the explorer offers to try, and will carry a skill that writes a repository in the format.
2. GitHub App and MCP OAuth for private repos; permission cache and webhook invalidation; project tokens. Open: the permission cache TTL, and how aggressive invalidation must be for SSO-enforced orgs. Write `specs/permissions.md` first.
3. `worker` role: webhook-driven and scheduled re-indexing.
4. `intake`, and composed tools declared in Markdown or YAML.
5. Self-hosted compose bundle, with a published image for self-hosters; GitLab and Gitea adapters.

## Later, undecided

Rankings on the landing page, fed by the usage statistics. Embedding search. A command-line client. A work-board module for parallel agents. Signed-commit verification for publishers. Aliases for verified publishers.
