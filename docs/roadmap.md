# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues; this file stays coarse.

## Done

- **Foundation.** Monorepo layout, pinned toolchain, lint, typecheck and test pipeline, CI, container image with role dispatch, license, contributor and agent documentation.
- **Milestone 1: serve a public repository end to end.** An MCP client connects to `/gh/<owner>/<repo>` for a public GitHub repository and can `find`, `get` and `read_file`: address and skill-repo parsers in `core`, the GitHub adapter, the first schema with full-text search, the `api` and `migrate` roles with lazy indexing, reference skill repos, an end-to-end test with the MCP client SDK, and what the server needs to run behind a reverse proxy. Publishing and deployment are not part of this repository ([ADR-0008](adr/0008-repository-ends-at-an-image-that-builds.md)); the milestone is really over with the first hosted staging deployment.

## Now: milestone 2, the web UI

Goal: a person opens the service in a browser, understands what it does in their language, pastes an address and sees what an agent would get from it.

- [x] REST API v1 per [specs/rest.md](specs/rest.md): what an address serves, `find`, one skill, one file, featured addresses
- [x] `web`: landing page and explorer, in English and Korean, prerendered per language with metadata, structured data, social-preview images and `llms.txt` ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md)). Design decisions made with the maintainers: a restrained developer-tool look, one blue accent, light and dark, a placeholder symbol until there is a logo
- [x] `server`: serves the web build when `WEB_ROOT` is set, answers browsers on addresses, generates `sitemap.xml` and `robots.txt` from `PUBLIC_URL`
- [x] The UI runs on its own for whoever designs it: one command, fixture data for every state, no database, no server, no container runtime; Windows and macOS
- [x] Usage statistics, on the server side: counts per public repository and skill (connections, tool calls, skills loaded), aggregated per day in PostgreSQL, so that rankings on the landing page have history by the time they are built. Statistics of private repositories are never collected.
- [x] Distinct clients per repository and day, counted without storing anything that identifies one ([ADR-0010](adr/0010-distinct-clients-by-daily-keyed-hash.md)). Clients are told apart by address until MCP OAuth gives them an account.
- [x] Repository pages rendered on the server with their data, indexable, with the featured and the popular repositories in the sitemap ([ADR-0011](adr/0011-address-pages-rendered-on-the-server.md))

Login and repository connection arrive with private repositories (item 3 below).

Design points still open (record the outcome in the spec or an ADR):

- Pinned commits that the host serves through a repository without being part of its history (see the open questions in the address spec).
- Abuse controls for the anonymous endpoints. The server bounds its own work: request and index size limits, bounded indexing per process, a short in-process memory of names that do not exist. Limiting requests per client is the job of whatever sits in front of the server. Still missing here: a negative cache shared between replicas.

## Next

1. MCP in depth: connect real MCP clients, by hand, to a running server and improve what they show. Candidates, to be scoped when the work starts: what each client does with the tool set and the server instructions, result wording and ranking in `find`, snippets for documents without a description, browsing a directory, skills offered as MCP prompts and documents as MCP resources, a structured result form next to the text. Also: a connection is counted when a client finishes `initialize`, which the 2026 protocol revision does not have; decide what to count there.
2. User documentation: how to write a skill repository and how to use one from an agent. Written for repository authors and the people who use their repositories, not as a description of internals. One source: every topic lives in exactly one Markdown file in this repository, the published documentation is rendered from those files, and everything else links to them instead of repeating them. How it is published is decided when the work starts.
3. GitHub App and MCP OAuth for private repos; permission cache and webhook invalidation; project tokens. Open: the permission cache TTL, and how aggressive invalidation must be for SSO-enforced orgs. Write `specs/permissions.md` first.
4. `worker` role: webhook-driven and scheduled re-indexing.
5. `intake`, and composed tools declared in Markdown or YAML.
6. Self-hosted compose bundle, with a published image for self-hosters; GitLab and Gitea adapters.

## Later, undecided

Rankings on the landing page, fed by the usage statistics. Embedding search. A command-line client. A work-board module for parallel agents. Signed-commit verification for publishers. Aliases for verified publishers.
