# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues; this file stays coarse.

## Done

- **Foundation.** Monorepo layout, pinned toolchain, lint, typecheck and test pipeline, CI, container image with role dispatch, license, contributor and agent documentation.
- **Milestone 1: serve a public repository end to end.** An MCP client connects to `/gh/<owner>/<repo>` for a public GitHub repository and can discover, load and read skills and documents: address and skill-repo parsers in `core`, the GitHub adapter, the first schema with full-text search, the `api` and `migrate` roles with lazy indexing, test-only repository fixtures, an end-to-end test with the MCP client SDK, and what the server needs to run behind a reverse proxy. Publishing and deployment are not part of this repository ([ADR-0008](adr/0008-repository-ends-at-an-image-that-builds.md)); the milestone is really over with the first hosted staging deployment.

- **Milestone 2: the web UI.** A person opens the service in a browser, understands what it does in their language, pastes an address and sees what an agent gets from it: REST API v1 ([specs/rest.md](specs/rest.md)); the landing page and the explorer in English and Korean, prerendered per language with metadata, structured data, social-preview images and `llms.txt` ([ADR-0009](adr/0009-web-ui-prerendered-per-language.md)), with the design decided with the maintainers (an approachable creative landing page, one blue accent, layered dark surfaces, and the existing branching symbol); the server serves the build, renders the page of an address with its data so that it can be indexed, and generates `sitemap.xml` and `robots.txt` ([ADR-0011](adr/0011-address-pages-rendered-on-the-server.md)); the UI runs on its own for whoever designs it, from fixtures or against a running server; usage statistics per public repository and skill, and distinct clients counted without identifying one ([ADR-0010](adr/0010-distinct-clients-by-daily-keyed-hash.md)); search-console and analytics tags from configuration. Login and repository connection arrive with private repositories.

## Now: milestone 3, MCP in depth

Goal: an agent that connects to an address knows what it got and uses it well, whatever the client; a person who opens the page of a repository connects their agent from there.

- [x] Connection instructions and server info introduce an address; document summaries use the first paragraph when no description is declared
- [x] Repository-root content paths, real folder browsing with counts and metadata, scoped search paged after folding, exact `get_skill` with complete inherited rules through continuations, text and structured output, one `use_skill(path)` prompt, and matching REST and web navigation ([ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md))
- [x] The MCP endpoint answers browsers on any origin, as the REST API does
- [x] The page of a repository leads with its name and description, then the steps to connect it to the common clients, and shows what the agent is told when it connects
- [x] Beginner-friendly connection guide: bundled client icons, English/Korean animated screen illustrations, manual steps and reduced-motion support, copyable setup and a first-message prompt ([guide contract](specs/connect-guide.md))
- [x] Creation-focused landing and explorer: editorial skills from the separate examples repository, a local concept clip that loads when seen and stands in for itself as a poster, an animated conversation, a language list, and a consistent wordmark and symbol
- [x] Landing copy that promises rather than explains, in both languages; structured data for the site, the clip and the questions, and an `llms.txt` that says what the site is in one sentence; files served with byte ranges, which video on phones needs; where a browser refuses the clip, the same clip as an animated AVIF
- [x] A URL without a language is served in the language the request asks for, so link previews follow the app that fetches them ([ADR-0021](adr/0021-a-url-without-a-language-is-served-in-the-language-asked-for.md))
- [x] The repository manifest supplies names, descriptions, common rules and document roots; parser diagnostics appear in API results and the `check` role ([ADR-0020](adr/0020-a-check-role-reads-a-working-tree-with-the-indexer.md)); provenance notices respect the user's requested task ([ADR-0019](adr/0019-the-operator-vouches-for-repositories-until-owners-can.md))
- [x] Generic declared-content rules for valid skills under hidden ancestors, explicit hidden includes and documents, recursive local Markdown references, and fail-closed manifest boundaries that survive indexing limits ([format](specs/skill-repo.md), [ADR-0022](adr/0022-repository-paths-and-progressive-skill-loading.md))
- [x] Names and descriptions translated for people: `translations` in both manifests, shown on the page in the visitor's language ([ADR-0018](adr/0018-skillcdn-fields-in-skill-md-under-one-key.md))
- [ ] Connect real clients by hand, to a local server and to the hosted service, and fix what they show. Nothing in this repository can test that; it is done after every change to what a client sees.

Design points still open (record the outcome in the spec or an ADR):

- Pinned commits that the host serves through a repository without being part of its history (see the open questions in the address spec).
- Abuse controls for the anonymous endpoints. The server bounds its own work: request and index size limits, bounded indexing per process, a short in-process memory of names that do not exist. Limiting requests per client is the job of whatever sits in front of the server. Still missing here: a negative cache shared between replicas.

## Next

1. User documentation: how to write a skill repository and how to use one from an agent. Written for repository authors and the people who use their repositories, not as a description of internals. One source: every topic lives in exactly one Markdown file in this repository, the published documentation is rendered from those files, and everything else links to them instead of repeating them. How it is published is decided when the work starts. The format a repository follows is specified as the SkillCDN Format in [specs/skill-repo.md](specs/skill-repo.md); `skillcdn/examples` is its reference repository, the one the explorer offers to try, and will carry a skill that writes a repository in the format.
2. GitHub App and MCP OAuth for private repos; permission cache and webhook invalidation; project tokens. Open: the permission cache TTL, and how aggressive invalidation must be for SSO-enforced orgs. Write `specs/permissions.md` first.
3. `worker` role: webhook-driven and scheduled re-indexing.
4. `intake`, and composed tools declared in Markdown or YAML.
5. Self-hosted compose bundle, with a published image for self-hosters; GitLab and Gitea adapters.

## Later, undecided

Rankings on the landing page, fed by the usage statistics. Embedding search, and a search that understands inflected languages (a Korean query finds nothing in a Korean repository unless the words are written the same). A command-line client. A work-board module for parallel agents. Signed-commit verification for publishers. Aliases for verified publishers.
