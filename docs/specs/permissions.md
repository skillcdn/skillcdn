# Spec: people, private repositories and access

- Status: **Draft.** Signing in, private repositories on the pages, over REST and over MCP, and the authorization server are implemented. Webhooks that end an answer early and tokens for headless agents are not ([roadmap](../roadmap.md)).
- Implemented by: `apps/server/src/auth/` and `apps/server/src/mounts/`, the GitHub App and login adapter in `packages/github`, the queries in `packages/db`, and the page contracts in `packages/core/src/rest/account.ts`. Decisions: [ADR-0035](../adr/0035-people-sign-in-through-the-git-hosts-app.md), [ADR-0036](../adr/0036-the-deployment-is-the-authorization-server-of-its-addresses.md).

Everything here exists only on a deployment that is configured for signing in ([deploy](../../deploy/README.md#signing-in-and-private-repositories)). Without that configuration there are no people, no private repositories and none of these routes: the deployment serves public repositories to everyone, as before.

## The model

- **The git host owns permissions.** A person is an account of the git host that signed in. There are no users, teams or roles of our own: whether someone can see a repository is asked of the git host, as that person, and only its yes or no is kept, for a short while.
- **Nothing is required for what is public.** A public repository is served to everyone, signed in or not, with or without a token, and what is served does not depend on who asks.
- **What is not public is served to exactly the people the host shows it to**, and only where the git host's app is installed on the repository. To everyone else it does not exist, in the same words and after the same work as a name that really does not.
- **Fail closed.** No answer is no access. When the git host cannot be asked whether a person can see a repository, the request fails; an answer about a person that has run out is never stretched.

Five credentials are involved, and none of them is in two places:

| Credential | Who holds it | What it is used for |
|---|---|---|
| The deployment's own (`GITHUB_TOKEN`, optional, without scopes) | The server | Reading what everyone can read. |
| The app's installation token | The server, in memory | Reading a repository that is not public. Minted from the app's key for the installation that covers the repository, and restricted to reading contents and metadata whatever the installation would allow. |
| The person's token of the git host | The server, encrypted at rest | Asking the host what that person can see, and listing where the app is installed for them. Never reading content, never leaving the server. |
| A session | The person's browser, as a cookie | The pages and the REST API. |
| An access token of this deployment | The person's AI app | One address, over MCP. |

## What is served to whom

An address is resolved the same way for the pages, the REST API and MCP. Who the request is for comes from its credential: a session for the pages and REST, an access token for MCP, and nobody without one.

**For nobody in particular**, the name is looked up as everyone sees it, with the deployment's own credential. A public repository is served. Anything else is not found, and that the name is nothing to the public is remembered for as long as facts about names are (`REPO_TTL_SECONDS`), for the next request from nobody: in the process, and in the database, so that every process of the deployment stops asking the host about the name.

**For a person**, in this order:

1. **What is known to be public.** A repository the host was lately seen to show everyone is served to a person as it is to anyone, before the request is even asked whose it is: what is public needs nobody's permission.
2. **What the host last let them read.** While that answer and the facts of the repository are fresh, it is served, and nobody is asked. When the answer has run out, the host is asked as the person again before anything else.
3. **As everyone.** The host is asked what the name is to the public. A public repository is served.
4. **As the person.** The host is asked, with the person's own token, which repository the name means to them. Nothing, and the answer is the same not-found.
5. **Through the installation.** The repository the person can see is read with the app's installation token. No installation on it, or a name that means another repository to the app than to the person, is the same not-found.

**Nothing one caller leaves behind answers another.** A stranger could otherwise tell, from how fast "not found" comes, that somebody uses a name. The memory of names that are nothing to the public is written only by requests from nobody in particular, so the people of a private repository leave no trace in it; that a name was nothing to a person is remembered for that person alone, in the process that learned it; and a yes is stored for the person it was given to. The one thing every caller reads is that a repository is public, which says only what the host tells everyone. So a request from someone who may not see a repository, signed in or not, takes the same steps and meets the same state for a private repository in use as for a name that is nothing, and asks the host as the person before anything is read.

| Repository | Asked by | Answer |
|---|---|---|
| Public | Anyone | Served. |
| Not public | A person the host shows it to, with the app installed on it | Served, with `visibility: "private"`; nothing between the server and them may keep it. |
| Not public | Anyone else, or nobody | `404 mount.repo_not_found` over REST and for a signed-in MCP client; the [challenge](#the-challenge) for an MCP request without a token. |
| Does not exist | Anyone | The same. |

What follows from a repository not being public:

- Responses are `cache-control: private, no-store`; MCP results carry `cacheScope: "private"`. The page of the address is not offered to search engines and has no social preview, and `/social/` and `/icon/` answer `404` for it, as for a name that is nothing.
- It is never on a list the deployment makes for everyone: not among the featured repositories, not on the [page of its account](rest.md#get-apiv1ownersghowner), not in the usage statistics.
- Its index is the same index: one per `(repository, commit)`, built with the installation token, read only through a mount that was resolved for the person asking. File bodies are stored by their git hash and shared between repositories; a body is only ever read through an index entry of a snapshot the caller was resolved for, and an entry exists only for a hash the host listed in a tree of that repository, so a hash from anywhere else opens nothing.
- The operator's blocked list still wins: a blocked repository does not exist for its own people either.

## The permission check

Whether a person can see a repository is asked of the git host with that person's token and remembered as `(user, repository) → allowed, checked at` in the database, so that every replica shares the answer.

- An answer is believed for `PERMISSION_TTL_SECONDS` (default 60; `0` asks every time). That is the **staleness bound**: someone who loses access at the host keeps it here for at most that long, and someone who gains it waits at most that long. Nothing ends an answer earlier yet; webhooks will ([roadmap](../roadmap.md)).
- Every request that reads something not public checks: pages, REST, every MCP call, cached reads included.
- About a person, only a yes is kept in the database. That a name was nothing to everyone and to the person is remembered for that person, in the process, for the same time: anyone who signed in can ask about any name, each question costs requests to the host, and a stored no would be something a stranger's question could find for a repository and not for a name that is nothing.
- The name has to mean the same repository to the person and to the app: a renamed or recycled name is another repository, compared by the host's immutable id.
- When the host cannot be asked and no answer is fresh, the request fails with `503 mount.unavailable` or `mount.rate_limited`. An answer written by a process whose clock runs ahead is not believed longer for that.
- What is public is another matter and an older rule: that a repository is public is believed for `REPO_TTL_SECONDS`, and somewhat longer while the git host cannot be asked, so that an outage of the host does not take public repositories down. Making a repository private therefore takes effect here within that time, and within the permission time for its own people.

## Signing in

People sign in through the git host's app ([ADR-0035](../adr/0035-people-sign-in-through-the-git-hosts-app.md)). These are navigations, not API calls.

| Route | What it does |
|---|---|
| `GET /auth/gh/login?return_to=<path>` | Sends the browser to the git host, with PKCE and a state, and remembers both in a sealed cookie for ten minutes, bound over TLS to this very host (`__Host-skillcdn_login`) so that a sign-in someone else began cannot be planted in a browser and finished there. `return_to` is a path of this origin; anything else becomes `/`. |
| `GET /auth/gh/callback` | Where the host sends the browser back. Exchanges the code, stores the person's token encrypted, starts a session and goes to `return_to`. A sign-in that did not complete goes to `/account?login=denied`, `expired` or `failed`. |
| `POST /auth/logout` | Ends the session of this browser. Must come from the deployment's own pages (`origin` is checked); answers `204`. Apps the person connected keep working until they are removed. |

- **The session** is a random token in a cookie and its SHA-256 in the database, so the `api` role keeps no session state and any replica answers any request. The cookie is `HttpOnly`, `SameSite=Lax`, for the whole origin, and over TLS `Secure` under the name `__Host-skillcdn_session` (plain `skillcdn_session` on `http`, for development). A session ends `SESSION_TTL_DAYS` (default 30) after it was last used.
- **The person's token** is sealed with AES-256-GCM under a key derived from `AUTH_SECRET`, bound to the user it belongs to, and read in one place. Where the host issues expiring tokens it is renewed with its refresh token, once for all requests that find it expired. It is never logged and never part of an answer.
- **Losing the credential signs the person out everywhere.** When the host refuses the token and it cannot be renewed (the person revoked the app, or the refresh token ran out), the stored credential, every session, every grant to an app, and every remembered answer of that person are deleted. They sign in again and allow their apps again.
- A request that changes something for the person signed in (`POST /auth/logout`, `DELETE /api/v1/me/grants/<id>`, `POST /api/v1/oauth/decision`) is accepted only with the deployment's own `origin`, on top of the cookie not travelling with other sites' requests.

What a signed-in person has here is in the [REST API](rest.md#people): who they are, the repositories they can reach through the app, and the apps they allowed.

## MCP: authorization is optional

An MCP client needs no token for a public address and never will, and a public address shows no sign that there is anything to sign in to: it never asks for a credential, and nothing about signing in is published for it. To a client it is what it is on a deployment where nobody signs in, however the client decides whether a server wants a sign-in. The deployment is its own OAuth 2.1 authorization server ([ADR-0036](../adr/0036-the-deployment-is-the-authorization-server-of-its-addresses.md)), following the authorization part of the MCP specification: protected resource metadata (RFC 9728), authorization server metadata (RFC 8414), client ID metadata documents, dynamic client registration (RFC 7591), PKCE with `S256`, resource indicators (RFC 8707) and the `iss` response parameter (RFC 9207).

| Request to an address | Answer |
|---|---|
| No `authorization` header, public repository | Served, as always. |
| No `authorization` header, anything else | `401` with [the challenge](#the-challenge) and `auth.required`. |
| A valid token for this address, a repository its person can see | Served. |
| A valid token for this address, anything else that is not public | `404 mount.repo_not_found`. |
| A token that is unknown, expired, revoked, malformed, or issued for another address | At a public address: served, as to anyone, since no credential is needed there. Anywhere else: `401` with the challenge, `error="invalid_token"` and `auth.invalid_token`, so that a client is told when its credential is no good. |
| A valid token whose person the git host no longer vouches for | The same `401`: they sign in again. |

On a deployment without signing in, a request for anything that is not public is `404 mount.repo_not_found`, and an `authorization` header means nothing.

### The challenge

```
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/gh/<owner>/<repo>", scope="read"
```

The same challenge answers a private repository and a name that is nothing, so it says where to ask for access and not whether there is anything to access. A public address never sends one, whatever it is sent. Browser clients can read it: the header is exposed to every origin.

### Discovery

- `GET /.well-known/oauth-protected-resource/<address>` describes an address that asks for a credential as a protected resource: `resource` (the URL as the client spelled it), `authorization_servers` (the issuer), `scopes_supported: ["read"]`, `bearer_methods_supported: ["header"]`. It exists for exactly the addresses that answer nobody in particular with the challenge, a private repository and a name that is nothing alike, and is `404` for an address everyone is served; `503` when the git host cannot say which it is. Nobody keeps the answer (`no-store`), because a repository can stop being public.
- The issuer is `<origin>/oauth`, not the origin. Its metadata is at `GET /.well-known/oauth-authorization-server/oauth`, where RFC 8414 puts it for an issuer with a path, and at `GET /oauth/.well-known/oauth-authorization-server`, where clients that append to the issuer look. There is nothing at `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration` or `/.well-known/oauth-protected-resource` themselves.
- Why not at the root: some clients decide whether a server wants a sign-in before they connect, by looking for these documents from the server's URL up to the root of its origin, and sign in at once when they find one. A document at the root would make every address of the deployment look like one that wants a sign-in. Kept under the issuer and under the addresses that ask, it is found by a client that was asked, and by no other.
- The server's metadata is the endpoints below, `code` as the only response type, `authorization_code` and `refresh_token` as the grant types, `S256`, the client authentication methods `none`, `client_secret_post` and `client_secret_basic`, `client_id_metadata_document_supported: true` and `authorization_response_iss_parameter_supported: true`.

Both are public documents, answered to any origin.

### Clients

A client is one of two things, and either way what it says about itself is its own word:

- **A metadata document.** A `client_id` that is an `https` URL with a path, on the default port, without credentials, fragment or dot segments, is fetched: over TLS to public addresses only, without following redirects, at most 64 KiB within five seconds. The document must name that URL as its `client_id`. It is kept for as long as its `cache-control` says, between five minutes and a day, an hour when it does not say; a document that cannot be read leaves the last copy standing. Such a client is a public client.
- **A registration.** `POST /oauth/register` (RFC 7591) accepts `redirect_uris` (1 to 16), `client_name`, `client_uri`, `token_endpoint_auth_method` (`none`, `client_secret_post` or `client_secret_basic`), `grant_types` and `response_types`, and answers `201` with a `client_id` and, for a client that asked for one, a `client_secret` that is shown once. Anyone may register: a registration grants nothing until a person agrees. One that nobody ever allowed anything is removed after a week.

The documents that ChatGPT, Claude, Claude Code, Codex CLI and VS Code publish, as they were on October 4, 2026, are part of the tests: extra fields, grant types this server does not issue and redirect URIs on this computer without a port are all read as their authors mean them.

Clients that nobody has allowed anything yet are bounded in number, registrations and documents together. At the bound a registration answers `503` with `temporarily_unavailable` and `retry-after`, and a document never seen before is not fetched; clients that are already known keep working.

A redirect URI is `https`, or `http` to this computer (`localhost`, `127.0.0.1`, `[::1]`), or a scheme of the client's own; never a fragment, credentials, or a scheme that runs in the browser. A request must name a registered URI exactly; for a client on this computer the port may differ, since such a client learns its port when it starts listening.

### The flow

1. `GET /oauth/authorize` takes `response_type=code`, `client_id`, `redirect_uri` (optional when the client registered exactly one), `state`, `code_challenge` with `code_challenge_method=S256`, and `resource`, which must be the URL of an address of this origin. Whatever is wrong with a request is shown on the consent page (`/oauth/consent?error=<code>`, with the OAuth error code for whoever builds the client) and the browser is sent nowhere else: anyone can register a client, so a request that is merely wrong must not be a link on this origin that leads to its author's URI. A browser goes to a client only with a person's answer.
2. The request is sealed (encrypted and good for ten minutes) and the browser goes to `/oauth/consent?request=...`. Nothing is stored yet, so asking costs the deployment nothing.
3. **The consent page** shows who asks (the name the client gave itself, marked as its own word), the address it wants to read, who its answer goes to, and who is signed in. Who the answer goes to is what actually receives the access: the host of a web address, or for a link of an app's own the scheme and nothing that the link writes after it, with a note when that is an app on the person's computer. Nobody signed in: the page offers to sign in and comes back. The person can allow, cancel, or sign out and answer as someone else.
4. **Only an address its person can open is allowed.** Up to here a name that is nothing went the way a private repository goes: the same challenge, the same metadata, the same page for whoever is not signed in. Once the person is known, the page asks the question only if they can open the address. If they cannot, it says so in one sentence that covers a repository that does not exist, one the host does not show them, and one the app is not installed on, since it may not tell them apart; it offers where the app is added to repositories and to look again, and the one answer left is to go back to the client. When the git host cannot be asked, nothing is allowed either. The decision is enforced where it is made: approving such a request is `403 oauth.not_visible`, or `503` without an answer from the host. A connection that cannot work so fails where the person can read why, instead of answering not-found to every call after it.
5. Allowing returns the browser to the redirect URI with a `code`, the `state` and `iss`; cancelling, and going back from an address that cannot be opened, return `error=access_denied` in the same words, so that a client does not learn from the refusal whether its person could have said yes. A code is good once, for sixty seconds.
6. `POST /oauth/token` with `grant_type=authorization_code`, the `code`, the `code_verifier`, the client (and its secret when it has one), and optionally `redirect_uri` and `resource`, which must then match. A code is spent by being presented: when the verifier, the client, the redirect URI or the resource then turns out wrong, there is no second try with it.

### Tokens

- An access token allows reading **one address**: the exact canonical address the client named as `resource`, ref and path included. At any other address it is `invalid_token`. The one scope is `read`.
- Tokens are opaque random strings, recognizable by prefix (`scdn_at_` access, `scdn_rt_` refresh, `scdn_c_` code, `scdn_client_` and `scdn_cs_` for a registered client and its secret, `scdn_s_` session), and stored only as SHA-256 hashes.
- An access token lasts `ACCESS_TOKEN_TTL_SECONDS` (default one hour). A refresh token lasts `REFRESH_TOKEN_TTL_DAYS` (default 30) from the last exchange and is rotated: every exchange answers with a new pair. A refresh token presented again within a minute of its first use is answered with another new pair, for a client that did not receive the answer and for clients that share one credential store; presented later, it revokes the whole grant, because by then two holders of one refresh token means one of them should not have it.
- A token says who allowed it, never what they may see: every request checks the person's access with the git host as above. Removing access at the host therefore ends it here within the staleness bound, without anything being revoked.
- `POST /oauth/revoke` (RFC 7009) revokes the grant a token belongs to, for the client it was issued to. The person removes a grant from their account pages, which ends it at once.
- What a person can make is bounded. A grant keeps its eight newest token pairs, so a refresh token presented again and again stops being one; a person keeps a hundred grants, and allowing one more ends the one used longest ago.

## Not yet

- **Webhooks.** Installation, membership and visibility events will end remembered answers early and re-index on push. Until then the staleness bound above is the bound, and a private repository refreshes like a public one, when its ref is next resolved.
- **Tokens for headless agents.** An agent with no person in front of it cannot use this flow. A repository-scoped, read-only, expiring token issued by someone who administers the repository is planned.
- **Other git hosts.** Signing in goes through GitHub, the one adapter there is.
- **Asserted client keys.** A client's metadata document may name `private_key_jwt`; such a client is treated as a public client, protected by PKCE alone. ChatGPT's document names it as what it would rather use and `none` as what it also can, and the server's metadata offers `none`.
