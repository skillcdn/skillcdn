# ADR-0038: The git host's events end what is remembered, and establish nothing

- Status: Accepted
- Date: 2026-10-04
- Builds on [ADR-0035](0035-people-sign-in-through-the-git-hosts-app.md), whose answers of the git host were believed until their time ran out and no sooner. The contract is in [specs/permissions.md](../specs/permissions.md#events-of-the-git-host).

## Context

Everything a deployment believes about a repository is an answer the git host gave, with a lifetime: who can see it, what its name means, where a ref points. Until an answer runs out, a person removed at the host still reads, a repository made private is still served as public, and a push is not served. The host can say when such things change: its app has a webhook.

A delivery is a request from the internet to an endpoint anyone can reach. It can arrive twice, late, out of order or never, and the host does not try again by itself. And what the app may be told depends on what it may read: asking for more, once accounts have installed the app, means every one of them has to agree again.

## Decision

1. **The deployment receives the app's events at `POST /webhooks/gh`**, once it shares a secret with the host (`GITHUB_APP_WEBHOOK_SECRET`). Without the secret the route does not exist, and everything is as it was: lifetimes are the only bound.
2. **A delivery is nobody's until its signature is verified**: HMAC-SHA256 under the shared secret, over the bytes as they arrived, compared in constant time, before any of them is parsed. Up to 4 MiB are read; a larger delivery is refused unread.
3. **An event ends; it never establishes.** What a delivery says is not written down as true. It makes facts due for asking again (what a name means, where refs point), and forgets answers (who can see a repository); the next request asks the host. So a delivery that comes twice, late or out of order costs a question and changes no answer, and the server keeps no record of the deliveries it has seen.
4. **Closing is the one thing an event is believed for.** A repository the host says went private or was deleted stops being served as public at once, and a person who took back what they allowed the app is signed out at once. Believing such an event wrongly costs a question or a sign-in; waiting for a lifetime would leave open what the host has closed.
5. **What each event ends:**

   | The host says | What ends here |
   |---|---|
   | A branch or a tag was pushed, created or deleted (`push`, `create`, `delete`) | The refs of the repository are due. |
   | A repository was renamed, transferred, edited, archived or made public (`repository`, `public`) | Its names and refs are due, and the answers about who can see it are forgotten. |
   | A repository was made private or deleted (`repository`) | The same, and it is not public from that moment. A deleted repository's index is removed. |
   | The app was taken off an account, or off repositories (`installation`, `installation_repositories`) | The answers about those repositories are forgotten, and the index of each that was not public is removed. |
   | The app was suspended on an account (`installation`) | The answers about that account's repositories are forgotten. |
   | A person revoked the app (`github_app_authorization`) | Their credential, their sessions, the apps they allowed and the answers about them. |
   | A collaborator, a team or a member changed (`member`, `team`, `team_add`, `membership`, `organization`) | The answers about the repository named, or about every repository of the organization. |

6. **A push does not index.** It makes the refs due; the next request for the address resolves the new commit and indexes it, which costs what changed. Indexing every push would build an index for commits nobody asks for, of repositories nobody may open again, and nothing removes an old commit's index yet. Indexing ahead of requests belongs to the `worker` role, with a rule for which commits are kept.
7. **Taking the app off removes what it read.** An owner who removes the app from a repository withdraws what let the deployment read it; what was indexed of a repository that was not public is deleted with the event, not kept until somebody purges it. What is public was read as anyone reads it, and stays.
8. **The app asks for no more than before.** Pushes and changes to a repository are told to an app that may read contents and metadata, which is what reading needs anyway; installations and revocations are told to every app. Changes of collaborators, teams and members are told only to an app that may read an organization's members. The server acts on those events when they arrive, and whether to ask organizations for that permission is the operator's decision, made when the app is registered: without it, the permission lifetime remains the bound for such changes.
9. **What ends, ends in the database.** The process that receives a delivery tells no other: every replica reads the same facts and the same answers.

## Consequences

- Where the app is installed, a push is served by the next request, a repository made private or deleted closes at once, and removing the app removes private content. `PERMISSION_TTL_SECONDS`, `REPO_TTL_SECONDS` and `REF_TTL_SECONDS` remain the bound for everything the host does not announce, and for a delivery that never arrives: a person removed from a repository of an app without the members permission, an organization that withdraws a person's single sign-on, a host that could not reach the deployment.
- Facts are made due, not deleted: while the host cannot be asked, a public repository is still served from what was known, for as long as it would have been without the event. Answers about people are deleted, and without the host there is no access, as before.
- The endpoint answers anyone. An unsigned delivery costs one hash over at most 4 MiB and is refused; a signed one can only make the server ask the host again, so there is nothing to gain by replaying one.
- An event about a repository this deployment never opened is nothing to it, and most are: an account that installs the app on everything sends events for repositories that hold no skills.
- The operator decides the app's permissions once. Adding the members permission later makes every account that installed the app agree again, and until one does the permission does not apply to its installation; the server needs no change for it.
- Rejected: writing down what a delivery says (the pushed commit as the ref, `public` on a repository said to have opened), since a delivery that arrives late would roll a ref back or open what was closed since; a table of delivery ids against replays, which would guard something a replay cannot harm; indexing on push, for the reason in 6; asking for the members permission for everyone, when reading needs only contents and metadata and a minute's delay on a membership change is the bound people already accepted.
