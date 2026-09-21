# @skillcdn/github

The GitHub implementation of the git-host port defined in `@skillcdn/core`. It is the only place in the codebase that talks to GitHub.

**Status:** the adapter for repositories readable with one optional credential is implemented (first row below). App authentication, the permission check and webhooks follow ([roadmap](../../docs/roadmap.md)).

## Scope

| Capability | Used for | Credential |
|---|---|---|
| Resolve a ref to a commit; read trees and blobs | Indexing and `read_file` | None or an optional token for public repos; the App installation token for private repos |
| "Can this user see this repo?" | Permission check on private repos | The user's token |
| GitHub App: installation tokens, installation and repo selection events | Private repos | App private key |
| Webhook signature verification | Push, membership, team and visibility events | Webhook secret |

Other hosts (GitLab, Gitea) are separate packages that implement the same port.

## Usage

```ts
import { createGitHubHost } from "@skillcdn/github";

const gitHost = createGitHubHost({
  userAgent: "skillcdn",
  token: async () => config.githubToken, // optional; only raises the rate limit for public repos
});
const commit = await gitHost.resolveRef({ host: "gh", owner: "acme", repo: "skills" }, undefined);
```

- Every failure is a `GitHostError` with a `kind`: `not_found` (which also covers forbidden), `rate_limited` (with `retryAfterSeconds`), `transient` or `invalid`.
- Repository facts and moving refs are revalidated with `If-None-Match`; a `304` does not count against the rate limit. The cache is in memory, bounded, and an optimization only.
- Redirects are followed only within the configured origin, so credentials never leave it. Reply bodies are read up to a cap, whatever `content-length` claims.
- Transient failures are retried with jittered backoff. Rate limits are not retried here: the caller decides what to do with `retryAfterSeconds`.

## Fixtures

`fixtures/api.json` holds replies recorded from the public API without credentials and trimmed to what the adapter reads. Tests replay them through an injected `fetch`; nothing in the test suite touches the network. When you record new ones, keep them small and scrub them: no tokens, no private repositories, no personal accounts.
