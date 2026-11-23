# ADR-0126: An entry still to be embedded keeps the place its words give it

- Status: Accepted
- Date: 2026-11-24
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) (words and meaning fused by reciprocal rank, point 5), [ADR-0064](0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md) (a commit is embedded after it is indexed) and [ADR-0107](0107-a-commit-just-indexed-is-given-the-vectors-its-texts-had-already.md) (a body given only some of its vectors is unfinished). It amends what the fusion of ADR-0063 makes of an entry that has no vector yet.

## Context

A commit is served as soon as it is indexed, and embedded when the worker reaches it. Until then an entry of it that says something new has no vector: a skill given a new name, a document given a new title, a file said anew, and every document of a pack that is being embedded for the first time.

Such an entry was not merely found by its words alone, as the specification says of a document without vectors. The fusion counts 1 / (60 + rank) for each list that holds an entry. An entry with no vector cannot be in the list by meaning, so the first place by words counted 1/61 for it, where the fiftieth place in both lists counts 2/110: it stood behind every entry both lists held, whatever the words made of it. A skill pushed under a new name was not among the first results for its own name until its embedding ended. A pack embedded for the first time answered with the documents embedded so far, and not with the ones that held the words.

The search said nothing of it either, for a while: the line that says how far an embedding is came with the worker's first slice, and the job of a commit waits its turn before that.

## Decision

1. **While the embedding of an index is under way, an entry it has not reached keeps the place its words give it.** Where the list by meaning leaves such an entry out, the fusion counts its place among the words for both lists (`unplaced` of `fuseRanks`): the meaning has not said that the entry is far, since it could say nothing of it. This holds inside a mount and across the packs.
2. **The entries it holds for are the ones the line `N of M documents embedded so far` counts as not embedded**: a searchable document or skill that no manifest keeps to the words, whose body has no vector or is unfinished (ADR-0107). A store says which bodies those are (`unembedded` of `IndexStore`), and a store that does not is searched as before.
3. **Nothing else changes its place.** An index whose embedding is complete is ranked as before. So is an entry that is never embedded, which one list finds for good: a file that is not Markdown, a document a manifest keeps to the words, an entry of a repository nothing embeds.
4. **The embedding of a commit is under way from the moment its job is queued.** The process that indexed the commit writes the row of the snapshot's embedding when it leaves a body for the worker, where the worker's first slice wrote it. A search says how far the embedding is, and point 1 holds, while the job waits its turn.

## Consequences

- **An entry asked for by its name stands first while it waits for its vectors**, where the words put it first; a skill passes a document as it did (ADR-0095).
- **A pack being embedded for the first time is searched by its words where it is not embedded yet**, and no longer answers with the documents embedded first.
- **A waiting entry may stand higher than it will once it is embedded**: it stands where it would if the meaning agreed with the words. Beside it, an entry the meaning could have listed and did not stands where it stood, so a waiting entry may pass it.
- **An embedding that a bound stopped stays under way**, as the line that says how far it is goes on saying: where the repository's bound or the account's for the day leaves bodies unembedded, their entries keep the place their words give them for as long as the bound holds, where they stood behind every embedded entry. They are entries to embed, and not of the kind point 3 leaves alone.
- **An answer given while a commit waits for the worker says so, and no cache keeps it** (ADR-0096), where an answer given before the worker's first slice could be kept.
- **A search reads how far the embedding is before it fuses**, and, only while it is under way, which bodies of the words' entries are left. A search across the packs asks once whether a snapshot of the words' entries is being embedded.
- **A question that shares no word with a waiting entry still finds nothing of it.** The words cannot place what they do not find.
- **Rejected:**
  - counting a waiting entry at the last place of the list by meaning: it still stands behind the entries both lists hold near their top, the entry asked for by name among them;
  - leaving the meaning out of the fusion while an embedding is under way: the entries that are embedded would lose it as well;
  - the same for every entry without a vector, whether its index is being embedded or not: across the packs, an entry of a repository nothing embeds would stand among the entries both lists hold on its words alone, for good and not for the minutes an embedding takes.
