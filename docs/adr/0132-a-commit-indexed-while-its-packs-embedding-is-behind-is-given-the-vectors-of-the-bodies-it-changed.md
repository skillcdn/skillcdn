# ADR-0132: A commit indexed while its pack's embedding is behind is given the vectors of the bodies it changed

- Status: Accepted
- Date: 2026-11-28
- Builds on [ADR-0107](0107-a-commit-just-indexed-is-given-the-vectors-its-texts-had-already.md) (a commit just indexed is given the vectors its texts had already) and [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (a ref remembers the commit it was at before). It amends point 4 of ADR-0107.

## Context

A commit just indexed is given the vectors its texts have already, when at most 200 bodies are left to embed (ADR-0107, point 4). The number counted every body of the index that had nothing embedded, whoever left it so.

A pack whose embedding is behind has more than that left for a long time: one being embedded for the first time, or again under another model. A commit pushed to it then was given nothing, although it changed one file. The file had been embedded as it was before; its new body had no vector until the worker reached it in the order of the paths, and was found by its words alone meanwhile. "A file edited in one place keeps its meaning across a push" did not hold for exactly the packs that are embedded the longest.

## Decision

1. **Where more bodies are left than are given at once, only the bodies the commit changed are looked at**: those the snapshot of the commit the ref was at before does not hold. They are given the vectors their texts have, as ADR-0107 gives them, when they are at most 200.
2. **The rest is the worker's, as it was before the commit.** A body the commit before held without vectors waited for the worker already, and is neither read nor looked up.
3. **Where there is no commit before to tell them by, nothing changes**: a pack indexed for the first time, a pinned commit, a commit before that has no index. So with a commit that changed more than 200 bodies.
4. **At most 200 bodies left are all looked at, as before**, whichever commit left them.

## Consequences

- **A file edited in one place keeps its meaning across a push while its pack is still being embedded**, where the body it was before is embedded already.
- **A file whose earlier body the worker had not reached has nothing to be given**, and waits as before: its texts have no vector yet.
- **The cost is one read of the entries of the commit before**, and only where more than 200 bodies are left; then one read and one lookup for each changed body, as ADR-0107 has it.
- **How the embedding of the commit stands is said of every body left**, changed or not: the commit is under way while any waits (ADR-0126).
- **Rejected:**
  - raising the bound: a pack of thousands of documents would be read whole by the process that indexed it, for bodies whose texts have no vector to be given;
  - telling the changed bodies by every other snapshot of the repository: an index that was pruned makes old bodies look new, and the ref's own commit before is at hand on the mount;
  - embedding the changed bodies ahead of the rest in the worker: the order of a slice is the order of the paths, which is what lets a slice go on where the one before ended.
