# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues; this file stays coarse.

## Done

- **Foundation.** Monorepo layout, pinned toolchain, lint, typecheck and test pipeline, CI, container image with role dispatch, release workflow to a container registry, license, contributor and agent documentation.

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
- [ ] First hosted staging deployment from a published image. Before enabling publishing, make `release.yml` wait for a green CI run (see [deploy/README.md](../deploy/README.md)).
- [ ] End-to-end, by hand: add a public repo to an MCP client as a custom connector. Needs a reachable URL, so it follows staging.

Design points to settle during this milestone (record the outcome in the spec or an ADR):

- Pinned commits that the host serves through a repository without being part of its history (see the open questions in the address spec).
- Abuse controls for the anonymous endpoint. Today: request and index size limits, bounded indexing per process, a short in-process memory of names that do not exist. Missing: per-client rate limits and a negative cache shared between replicas.

## Next

1. GitHub App and MCP OAuth for private repos; permission cache and webhook invalidation; project tokens. Open: the permission cache TTL, and how aggressive invalidation must be for SSO-enforced orgs. Write `specs/permissions.md` first.
2. `worker` role: webhook-driven and scheduled re-indexing.
3. `web`: landing, explorer over the public index, login, repo connection.
4. `intake`, and composed tools declared in Markdown or YAML.
5. Self-hosted compose bundle; GitLab and Gitea adapters.

## Later, undecided

Embedding search. A command-line client. A work-board module for parallel agents. Signed-commit verification for publishers. Aliases for verified publishers.
