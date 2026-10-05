# ADR-0040: A token for an agent with nobody to sign in reads one repository, as its maker

- Status: Accepted
- Date: 2026-10-04
- Builds on [ADR-0035](0035-people-sign-in-through-the-git-hosts-app.md) and [ADR-0036](0036-the-deployment-is-the-authorization-server-of-its-addresses.md). The contract is in [specs/permissions.md](../specs/permissions.md#tokens-for-agents-with-nobody-to-sign-in). Replaces the plan this project started with, a "project token" issued by a repository's administrator as a permission layer of the deployment's own.

## Context

An AI app that reads a private repository signs in: a browser opens, a person agrees ([ADR-0036](0036-the-deployment-is-the-authorization-server-of-its-addresses.md)). A scheduled job or a server has no browser and no person. It needs something it can be given once and send with every request.

The first plan was a token of the repository's: made by whoever administers the repository, good until it expires or is revoked, whoever made it. That is a second permission system beside the git host's. It has to learn who administers a repository, to let other administrators see and revoke what one of them made, and it goes on reading for somebody who has left, until someone remembers to revoke it. Everything else here answers "who may read this" by asking the git host.

## Decision

1. **A person makes a token for a repository they can open**, on their account pages: any repository that is not public and that the git host shows them through the app. No role is asked for. A public repository gets none, since it needs none.
2. **The token reads as its maker.** A request that presents it is that person's request: resolved, checked against the git host and remembered exactly as their session's or their app's would be. It opens nothing its maker cannot open at that moment, and when the host takes the repository away from them, the token reads nothing, without anybody revoking it.
3. **It is good for one repository, at every ref and path of it**, under the name it was made for, and nowhere else. The repository is the host's immutable id: a name that comes to mean another repository does not carry the token over. Over MCP only; the pages and the REST API know people by their session.
4. **It ends**: when its time is up (a lifetime is chosen when it is made, a year at most), when its maker removes it, and with everything else of its maker's when the git host stops vouching for them.
5. **It is a secret like the others**: random, recognizable by its prefix (`scdn_repo_`), shown once, stored as a hash. A person holds at most fifty, and one more is refused rather than an old one ended, because an agent somewhere is using each.
6. **A refusal says as little as any other.** Making a token for a repository the person cannot open answers as a name that is nothing does. A token presented anywhere but at its repository is `invalid_token`, whatever is or is not there.

## Consequences

- There is still no permission of the deployment's own: a token says who made it and where it is good, never what that person may see. Taking someone's access away at the git host is all it takes, as for every other credential here, and the host's events end it as early as they end anything.
- A token stops working when its maker leaves, which a team's shared job will notice. Such a job belongs to an account that stays: the team's own machine account at the git host, signed in here like anyone.
- An agent's use keeps its maker's credential of the git host alive, since each use within the permission lifetime asks the host as them. A maker who revokes the app at the host ends their tokens with it.
- Whoever holds the token reads the repository, so it is a thing to keep where passwords are kept; its prefix lets a scanner that finds one say what it found.
- The apps that sign in are not offered tokens in the connection guide: a token is for what cannot sign in, and the guide of a private repository says so in one line.
- Rejected: a token that belongs to the repository and outlives its maker's access (a permission layer of our own, with roles to learn from the host and revocation by people who did not make it); asking for the administrator's role at the host (the token carries only what its maker reads already, so the role would add a question to the host and no protection); a token good for one address, like an app's (an agent that is configured by hand reads a branch today and a tag tomorrow, and a person who can read the repository can read all of it); never expiring.
