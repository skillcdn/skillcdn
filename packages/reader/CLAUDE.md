# packages/reader: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is the reads: what a mount answers, over an index wherever it is kept (ADR-0054).

- **One reader, every store.** A read is written once here, over the `IndexStore` port of `core`; the deployment's database and the command's memory are adapters that answer the same questions. Logic that depends on where the index is kept does not belong here.
- **The index comes from the caller.** `ReaderDependencies.index` answers the index of a mount's commit or that it is not ready; the reader never waits on its own, fetches on its own or keeps an index. What it caches is bounded, keyed by the index and the mounted path, and only saves reads.
- **Answers are data.** The reader returns results, lookups and `IndexNotReady`; the words for a model and the JSON of the API are written from them in `core`. A problem the caller can correct is a `ReaderInputError`, never a thrown string.
- **Paths stay in byte order.** The store answers entries in the order the index wrote them, and whatever this package sorts, it sorts with `compareByteOrder`, so that a page is the same on every machine.
- **Node.js only, nothing else.** No network, no database, no environment, no dependency beyond `core`.
