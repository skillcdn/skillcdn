# @skillcdn/github

The GitHub implementation of the git-host ports defined in `@skillcdn/core`. It is the only place in the codebase that talks to GitHub.

**Status:** reading repositories with the deployment's credential or the app's installation token, signing in and the permission question, and the public listing of an account are implemented. Webhooks follow ([roadmap](../../docs/roadmap.md)).

## Scope

| Capability | Used for | Credential |
|---|---|---|
| Resolve a ref to a commit; read trees, blobs and archives (`GitHost`) | Indexing and reads | None or an optional token for public repos; the App installation token when the coordinates say `credential: "installation"` |
| Installation tokens (`GitHubApp`) | Private repos | The app's private key: a short-lived app token finds the installation that covers a repository and mints a token for it, restricted to reading contents and metadata |
| Signing in, "which repository does this name mean to this person", where the app is installed for them (`GitHostLogin`) | Sessions, the permission check, the account pages | The app's client id and secret; the person's token |
| An account's profile and public repositories (`GitHostDirectory`) | The page of an account | None or the optional token |
| Webhook signature verification | Push, membership, team and visibility events; not built yet | Webhook secret |

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

With an app, one connection serves both adapters, so they share the HTTP client and the app's cached tokens:

```ts
import { connectGitHub, createGitHubHost, createGitHubLogin } from "@skillcdn/github";

const options = { userAgent: "skillcdn", app: { appId, privateKey }, clientId, clientSecret };
const connection = connectGitHub(options);
const gitHost = createGitHubHost(options, connection); // GitHost and GitHostDirectory
const login = createGitHubLogin(options, connection); // GitHostLogin
```

- Every failure is a `GitHostError` with a `kind`: `not_found` (which also covers forbidden, and a repository the app is not installed on), `rate_limited` (with `retryAfterSeconds`), `transient`, `invalid`, or `unauthorized`, which only a person's own credential produces: the host no longer accepts it, and its holder has to sign in again.
- The installation of a repository and its token are kept in memory, the token until shortly before it ends and a missing installation for a minute; requests that need the same token share one mint. A person's token is never kept, and nothing asked with one is cached.
- Repository facts and moving refs are revalidated with `If-None-Match`; a `304` does not count against the rate limit. The cache is in memory, bounded, and an optimization only.
- Redirects are followed only within the configured origin, so credentials never leave it. Reply bodies are read up to a cap, whatever `content-length` claims.
- `readArchive` is the optional bulk transport of the port: one request for the files of a commit. It streams the archive, keeps only the entries the caller asks for, counts bytes after decompression so that a small download cannot unpack into an unbounded one, and never writes to disk. The API redirects the download to another origin; only the origins in `downloadOrigins` are followed (by default the download host of github.com, and none for other installations), and they never receive the credential. Callers verify every body against the hash in the tree.
- Transient failures are retried with jittered backoff. Rate limits are not retried here: the caller decides what to do with `retryAfterSeconds`.

## Fixtures

`fixtures/api.json` holds replies recorded from the public API without credentials and trimmed to what the adapter reads. Tests replay them through an injected `fetch`; nothing in the test suite touches the network. When you record new ones, keep them small and scrub them: no tokens, no private repositories, no personal accounts.
