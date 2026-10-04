# ADR-0035: People sign in through the git host's app, and the host answers every question about access

- Status: Accepted
- Date: 2026-10-03
- The contract is in [specs/permissions.md](../specs/permissions.md).

## Context

A private repository can only be served to someone the server knows, and only while the git host lets that person see it. The rules were fixed before any of it was built: the git host owns permissions, its tokens never leave the server, indexing never uses a person's token, and a repository someone may not see is indistinguishable from one that does not exist. What was open was how a person proves who they are, where the proof lives, and how often the host is asked.

## Decision

1. **A GitHub App, not an OAuth app.** One registration gives both things needed: a token for each installation, restricted to reading contents and metadata on the repositories an owner selected, and a token per person that sees nothing beyond where the app is installed. Signing in is the app's own authorization flow, with PKCE and a state bound to the browser.
2. **The person's token only asks.** It answers "which repository does this name mean to you" and "where is the app installed for you", and nothing is read with it. It is encrypted at rest with a key derived from a configured secret and bound to its user, renewed when the host issues expiring ones, and read in one module.
3. **Content is read through the installation.** A repository that is not public is fetched and indexed with the app's installation token, into the same index per repository and commit that public repositories use.
4. **Nothing one caller leaves behind answers another.** A request from nobody in particular is resolved as everyone sees the name. A person's request is answered like anyone's while the repository is known to be public; otherwise it looks at what the host last let that person read, then asks the host as everyone, then as that person, before anything is read through the installation. The memory of names that are nothing to the public is written only by requests from nobody, and a person's misses are remembered for that person alone. A name that is nothing and a repository someone may not see take the same steps to the same answer, whoever else uses the name.
5. **The host's yes is kept, briefly.** `(user, repository) → allowed, checked at` lives in PostgreSQL so that replicas agree, for a configured time that defaults to a minute. A no is not stored where a stranger's question could find it. Without a fresh answer and without the host, the request fails.
6. **Sessions are rows.** The browser holds a random token in a host-bound, script-proof cookie, the database its hash. A session can be ended, and no replica holds state of its own.
7. **Losing the credential signs the person out everywhere.** When the host refuses the token and it cannot be renewed, the credential, the sessions, the grants to apps and the remembered answers of that person are deleted together.
8. **Signing in is configuration, all of it or none.** The app's id, key, client id and secret and the sealing secret are set together, with a public origin and the web UI; without them the deployment has no people and serves what is public.

## Consequences

- There is no user, team or role model here to keep in step with the host. Removing someone at the host removes them here within the time an answer is kept.
- That time is the staleness bound until webhooks end answers early. Each request for something private costs a database read, and one request to the host per person and repository per period.
- A repository known to be public costs a signed-in person nothing more than it costs anyone. A name that is not known to be public is looked up for the person before the host is asked as everyone, which costs a read, and a name that is nothing costs each replica its own questions to the host, since a no is shared with nobody. Both are the price of telling a stranger nothing.
- Changing the sealing secret makes every stored credential unreadable: everyone signs in again, and nothing leaks.
- Private repositories need the app installed on them. A person who can see a repository where it is not installed gets the same not-found, and the account pages say what to do.
- Rejected: an OAuth app (its tokens reach every repository of the person, with more than read, and cannot be limited to selected repositories); reading private content with the person's token (an index tied to one person's access is not a shared index, and a token would be used for more than asking); stateless signed sessions (they cannot be ended); remembering answers in memory only (replicas would disagree for as long as the answer lives).
