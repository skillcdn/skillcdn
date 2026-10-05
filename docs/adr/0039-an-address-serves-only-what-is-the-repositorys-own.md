# ADR-0039: An address serves only what is the repository's own

- Status: Accepted
- Date: 2026-10-04
- Closes the open question of the [address scheme](../specs/address.md) about commits that do not belong to the repository, and narrows what a pinned address is.

## Context

An address names its content by a repository: `/gh/<owner>/<repo>` says whose words an agent is about to follow, on the page, in the client's list of servers, and in what the server says of itself. A git host answers for more under a repository's name than the repository holds.

GitHub keeps a repository and its forks in one network and serves a commit of any of them through any of them. It also keeps, under the repository a pull request is made to, a ref for the head of that request, and finds it when it is asked for by name. Both were tried against the host on the day of this decision: a commit that exists only in a fork was answered by the parent's commit, tree and archive endpoints, and `pull/<number>/head`, asked for under the parent's name, resolved to the fork's commit.

Anyone can fork a repository and open a pull request against it. So an address with a commit hash, or with such a name as its ref, served content the repository's owner never had, under the owner's name, to whoever was handed the link.

## Decision

1. **A ref name is a branch or a tag of the repository.** It is looked for among the repository's branches, then among its tags, and in nothing else the host keeps refs for. A name that says which it means (`refs/heads/..`, `heads/..`, `refs/tags/..`, `tags/..`) is taken at its word; any other `refs/..` names nothing.
2. **A commit hash is served from the history of the default branch only.** The host is asked to compare the commit with the head of the default branch, and the commit is the repository's own when the branch lacks nothing the commit has. A full hash is confirmed once and remembered for good; the first digits of one are resolved and confirmed every time, as a moving ref is.
3. **One answer for a commit that is nowhere and for one that is somebody else's**: the ref was not found, with what a commit hash is served from.
4. **What was remembered before is not trusted.** A confirmed pinned commit is remembered under a key that no ref name can have. What an earlier release remembered under the bare hash, having only seen that the commit exists, is never read again.
5. **The rule is the port's.** `GitHost.resolveRef` resolves only what is the repository's own, so a second host adapter owes the same, by whatever its host offers.

## Consequences

- A pinned address of a commit that is on another branch only, or that only a tag leads to, is not served any more. The host has no way to ask which branches or tags contain a commit short of comparing with each of them, and the default branch is the one question that is cheap and that nearly every pin answers to. Anything else is addressed by the name of its branch or tag.
- Where a branch and a tag share a name, the branch is served. Git itself would pick the tag; looking at branches first keeps the common case at one request.
- What it costs the host: a branch name one request, as before; a tag name two; a pinned commit two, once; a name that is nothing two, or three when it could be the digits of a hash.
- A history rewritten on the default branch leaves pins to the dropped commits working where they were confirmed already, and refused on a deployment that never saw them.
- Blobs need no rule of their own: a body is read by a hash that a tree of a resolved commit lists, so what cannot be resolved cannot be read.
- Rejected: serving such a commit with a notice (an agent follows what it reads, and the name in the address is the claim); accepting a commit that is the head of some branch (true today and false after the next push, so an address would work on one day and not the next); comparing with every branch and tag (a number of requests the repository's owner decides); a denylist of the host's other ref namespaces (the host adds them without saying).
