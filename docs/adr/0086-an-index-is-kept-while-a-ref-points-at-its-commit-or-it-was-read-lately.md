# ADR-0086: An index is kept while a ref points at its commit or it was read lately

- Status: Accepted
- Date: 2026-11-11
- Builds on point 6 of [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (whatever rule keeps indexes keeps, per ref, the last commit that has one), on [ADR-0085](0085-the-worker-indexes-a-pack-ahead-of-the-requests-for-it.md) (the worker indexes ahead of requests) and on [ADR-0039](0039-an-address-serves-only-what-is-the-repositorys-own.md) (a pinned commit).

## Context

Nothing removed an index but the purge of a whole repository and the git host's events about one. Every commit a ref passed through kept its snapshot, its entries and its embedding, and a pack that is pushed to daily leaves hundreds of indexes a year that no address resolves to; with the worker indexing every announced push, they accumulate with nobody asking. The bodies are stored once per hash and shared, so what grows is the entries and the vectors of sections that changed.

Two kinds of index are in use without a ref pointing at them: the commit an address is pinned to, which an agent asks for by its hash for as long as its workflow runs, and the commit a ref just moved on from, which a client may still hold a cursor into and which a ref moved back to finds ready.

## Decision

1. **The index of a commit a ref points at is kept, and so is the one of the commit it pointed at last.** For as long as the ref is remembered, whatever their age: the first is what the address serves, the second what it serves while the first is not ready (ADR-0068). A ref is remembered once somebody asked for it, until the host says it is gone (ADR-0085) or the repository is purged.
2. **Every other index is kept for `INDEX_RETENTION_DAYS` after it was last read.** A read notes itself on the index it was served from, at most once an hour and without the reader waiting for the write; an index is made as if it had just been read. So a pinned commit stays for as long as something reads it, and a commit a ref moved on from stays for the configured time after its last reader, thirty days unless the deployment says otherwise. `0` keeps every index.
3. **The worker removes what nothing keeps, hourly and a bounded number at a time.** A snapshot goes with its entries and its embedding progress, with the note that its commit was confirmed as a pinned one, and then with the bodies and the vectors of sections that no index entry of any repository names any more. An index that a process is building is left alone, and so is one that was written to within the time.
4. **A look that starts nothing keeps nothing.** What a crawler or a link preview is shown (ADR-0074) is not noted as a read.
5. **An idle repository is not forgotten.** The commit its default branch points at keeps its index however long nobody asks: forgetting it would take the pack out of the search across packs and off the pages that list it, for a saving of one index. Removing a repository stays the purge's and the host's events'.

## Consequences

- What a deployment stores per repository is bounded by its refs somebody asked for, two indexes each, and what was read within the time, instead of growing with every push.
- A pinned address nobody reads for the configured time is indexed again when it is next asked for, and confirmed again as a commit of the repository's own: it answers `indexing` until then, as on its first request.
- A cursor into a commit two pushes back is refused once that index is gone, as a cursor is refused after any move of its ref.
- The column arrived with every snapshot of the time counted as read at that instant, so the first removal after an upgrade comes one retention time later, and nothing that was in use before reads were noted is taken for unread.
- One conditional write per index per hour is added to reading, off the request's path.
- Rejected: keeping by ref alone, with nothing for a pinned commit (every pinned address would be indexed again and again) or with a ref of its own for each (a pin nobody uses would keep its index for good); forgetting a ref nobody asked about for a while (point 5); removing an index the moment no ref points at it (a ref moved back by a force push, or by a mistake corrected, would wait for an index it had a minute ago).
