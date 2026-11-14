# ADR-0097: A result across the packs is of a repository the git host showed to be public within a day

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0037](0037-an-account-has-a-page-made-from-what-the-git-host-shows-everyone.md) (only what is public now is shown to everyone), [ADR-0038](0038-the-git-hosts-events-end-what-is-remembered.md) (what the host announces ends what is remembered) and [ADR-0070](0070-a-deployment-is-searched-across-every-pack-it-serves.md) (the search across packs).

## Context

The search across packs covers the public repositories with an index, and "public" was what the index recorded the last time somebody asked for the repository's address. A mount asks the git host again whenever that answer is older than `REPO_TTL_SECONDS`, and where the owner installed the app the host announces a repository made private, which closes it at once (ADR-0038). Neither reaches a repository without the app whose address nobody asks for: made private, or deleted, it stayed in the index as public, and the search went on answering everyone with the names and descriptions of its skills and with excerpts of its documents, for as long as nobody asked for its address.

What is shown is what was public when it was indexed, and nothing newer: the deployment cannot read the repository any more. But an owner makes a repository private to take it back, and every other place that names repositories to everyone already asks the host first: the page of an account, the cards of the front page (ADR-0037).

## Decision

1. **A result of the search across packs is shown where the git host showed its repository to be public within a day.** Where it did, the index is believed and nobody is asked. Where the host's last word is older, or is from a time ahead of the process's clock, the host is asked before the result is shown, as for a card (`MountService.isPublic`): a repository it no longer shows to everyone is recorded as public no longer, and the search does not cover it again.
2. **No answer is no.** A host that cannot be asked, or that has not answered within two seconds, leaves the result out of this answer; the question goes on, so that the next search has the answer. Other results take its place: the search goes down its order until the answer is full.
3. **The packs asked about are those of the results to be shown**, not every pack a search covers: at most as many as an answer has results, together, and each at most once a day, since an answer of the host is kept with the repository for every process to read.
4. **A day is the bound**, the same a cache is given for the answer of a public address pinned to a commit, which is told the same thing: the commit never changes, but whether the repository is public may. The bound is a constant.

## Consequences

- A repository made private or deleted stops being found across the packs within a day of the host's last answer about it, where it used to be found until somebody asked for its address. Where the app is installed it still closes at once.
- The first search of a day that would show a pack nobody asked for meanwhile waits for the git host, once, for the packs of its results together. A deployment that reads the host without a credential spends one of its hourly questions a pack a day, where the pack appears in results at all.
- While the git host cannot be asked, results of packs it was not asked about for a day are left out, and come back with it. The packs of the deployment's own directory are asked about on disk.
- The words and the meaning are still looked up over every pack the index has as public: a repository the host was not asked about counts among the packs searched until a result of it is to be shown. Nothing of it is shown.
- Rejected: asking the host about every pack a search covers before searching (hundreds of questions for an answer of ten results). Rejected: a job of the worker that asks about every pack on a schedule (the search would depend on a role a deployment may not run, and would ask about packs no search shows); it can be added where the first search of a day should not wait. Rejected: the bound of a mount, `REPO_TTL_SECONDS` (a search would ask the host about every result nearly every time).
