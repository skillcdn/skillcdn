# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues; this file stays coarse.

## Done

- **Foundation.** Monorepo layout, pinned toolchain, lint, typecheck and test pipeline, CI, container image with role dispatch, license, contributor and agent documentation.

## Now: milestone 1, serve a public repository end to end

Goal: an MCP client connects to `/gh/<owner>/<repo>` for a public GitHub repository and can `find`, `get` and `read_file`.

- [x] `core`: address parser per [specs/address.md](specs/address.md), with hostile-input tests
- [x] `core`: skill-repo convention parser per [specs/skill-repo.md](specs/skill-repo.md) (front-matter, single- and multi-skill layouts)
- [x] `core`: ports for git host, blob store, clock, `Entitlements`, `UsageSink`; tool contracts per [specs/tools.md](specs/tools.md)
- [x] `github`: public-repo adapter (ref resolution, tree, blobs) with conditional requests and an optional token
- [x] `db`: first schema (accounts, repos, ref resolution, index entries with full-text search), migration tooling, integration-test harness
- [x] `server`: configuration module; `migrate` role; `api` role with `/healthz`, `/readyz` and the anonymous MCP endpoint; lazy indexing on first request
- [x] `skills/`: reference skill repos used as fixtures
- [x] End-to-end, scripted: the MCP client SDK against a locally running `api` and the live GitHub API, plus the same path in CI against fixtures (`apps/server/src/api.int.test.ts`)
- [x] Ready to run behind a reverse proxy: client address taken from a trusted proxy only, request ids and an access log, keep-alive and timeouts that suit a load balancer. Publishing and deployment are not part of this repository ([ADR-0008](adr/0008-repository-ends-at-an-image-that-builds.md)).
- [ ] First hosted staging deployment. Nothing to build here; it marks when the milestone is really over.

Design points to settle during this milestone (record the outcome in the spec or an ADR):

- Pinned commits that the host serves through a repository without being part of its history (see the open questions in the address spec).
- Abuse controls for the anonymous endpoint. The server bounds its own work: request and index size limits, bounded indexing per process, a short in-process memory of names that do not exist. Limiting requests per client is the job of whatever sits in front of the server; the server's part is to make that possible. Still missing here: a negative cache shared between replicas.

## Next

1. `web`: landing and an explorer over the public index, with the REST surface they need. Design and branding are settled with the maintainers before any of it is built. Login and repository connection arrive with item 4. Usage statistics start here, on the server side: counts per public repository and skill (connections, tool calls, skills loaded), aggregated per day in PostgreSQL, so that rankings on the landing page have history by the time they are built. Open: what can be counted about distinct clients without storing anything that identifies one. Statistics of private repositories are never public.
2. MCP in depth: connect real MCP clients, by hand, to a running server and improve what they show. Candidates, to be scoped when the work starts: what each client does with the tool set and the server instructions, result wording and ranking in `find`, snippets for documents without a description, browsing a directory, skills offered as MCP prompts and documents as MCP resources, a structured result form next to the text.
3. User documentation: how to write a skill repository and how to use one from an agent. Written for repository authors and the people who use their repositories, not as a description of internals. One source: every topic lives in exactly one Markdown file in this repository, the published documentation is rendered from those files, and everything else links to them instead of repeating them. How it is published is decided when the work starts.
4. GitHub App and MCP OAuth for private repos; permission cache and webhook invalidation; project tokens. Open: the permission cache TTL, and how aggressive invalidation must be for SSO-enforced orgs. Write `specs/permissions.md` first.
5. `worker` role: webhook-driven and scheduled re-indexing.
6. `intake`, and composed tools declared in Markdown or YAML.
7. Self-hosted compose bundle, with a published image for self-hosters; GitLab and Gitea adapters.

## Later, undecided

Rankings on the landing page, fed by the usage statistics. Embedding search. A command-line client. A work-board module for parallel agents. Signed-commit verification for publishers. Aliases for verified publishers.
