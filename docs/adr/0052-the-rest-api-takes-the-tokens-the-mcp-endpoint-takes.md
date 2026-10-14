# ADR-0052: The REST API takes the tokens the MCP endpoint takes

- Status: Accepted
- Date: 2026-10-14
- Builds on [ADR-0036](0036-the-deployment-is-the-authorization-server-of-its-addresses.md) and [ADR-0040](0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md), whose point 3 ("over MCP only; the pages and the REST API know people by their session") it amends. The contract is in [specs/rest.md](../specs/rest.md#authorization) and [specs/permissions.md](../specs/permissions.md).

## Context

The REST API began as the web UI's, and knows a person by the session cookie of the deployment's own pages. The credentials of milestone 5, an access token a person's app receives over OAuth and a repository token a person makes for an agent with nobody to sign in, were taken at the MCP endpoint only. A program built on the REST API, as the reference console is ([ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)), could therefore read public repositories and nothing else: it has no browser to sign a session in with, and a token it was given was answered with not-found. What an agent gets over MCP from a private repository, such a program could not give it.

## Decision

1. **The routes that read an address take the credentials the MCP endpoint takes**: `mounts`, `browse`, `find`, `skills` and `files` read an `authorization` header with the `Bearer` scheme, holding an access token of this deployment, good at the one canonical address it was issued for, or a repository token, good at every address of its repository. A request that presents one is that token's person's: resolved, checked with the git host and remembered exactly as over MCP.
2. **The answers are the MCP endpoint's, with one difference.** A valid token whose person can open the repository is served; one whose person cannot is `404 mount.repo_not_found`, like a name that is nothing. A token that is no good, unknown, expired, revoked, malformed, issued for another address or made for another repository, is `401 auth.invalid_token` with the `WWW-Authenticate` challenge of the address, at any address that is not public; at a public address the request is served as anyone's. The difference: a request without any credential is `404` for anything that is not public, as the REST API has always answered, not the challenge the MCP endpoint sends. The pages read `404` as a repository that may be private and offer to sign in, and a program that holds no credential has nowhere to start a sign-in from: a person gives it a token.
3. **A token presented wins** over a session cookie sent with the same request, and a header that is not a bearer credential is treated as a credential that is no good, as at the MCP endpoint.
4. **A token reads its repository and does nothing else as its person.** The routes that are a person's (`/api/v1/me`, the grants, the tokens, the consent) and the pages know a person by their session only.
5. **The REST API carries no prose for a model**: no connection instructions and no prompt. What the MCP endpoint says on connect is rendered from the overview the `mounts` route returns, and the specification says what a program that serves an agent should tell it.

## Consequences

- A program built on the REST API, a console, a command-line tool or a job, reads a private repository with a repository token a person made, and loses it exactly when the MCP endpoint would: with the token's end, and with its maker's access. Nothing changes for the pages or for public repositories.
- Agents still never hold a git-host token: such a program holds a token of this deployment, as an MCP client does, and keeps it where passwords are kept.
- `www-authenticate` is exposed to browsers on `/api/*` as it is at the MCP endpoint, and the `authorization` request header is allowed there.
- The listing of the MCP skills extension, the listed skills with their digests and the assembled `SKILL.md`, has no REST counterpart yet; a program that installs skills speaks MCP for it, or waits for the addition the REST spec leaves open.
- Rejected: a console that speaks MCP to the deployment, because its pages need data and a tool result is one text written for a model ([ADR-0034](0034-a-tool-result-is-the-text-written-for-the-model.md)); handing a token of this deployment to the agent through such a program, because the agent then holds a credential the program was meant to keep; a challenge on the REST API for a request without a credential, because the pages would have to learn a new answer for what `404` already tells them.
