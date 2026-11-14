# ADR-0095: A skill is boosted over a document once, where the results are put in one order

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) (words and meaning fused by reciprocal rank, point 5), [ADR-0070](0070-a-deployment-is-searched-across-every-pack-it-serves.md) (the search across packs) and [ADR-0094](0094-a-skill-is-embedded-as-its-name-and-description-as-well-as-its-sections.md) (a skill's head, and what it left to be measured). It replaces what point 5 of ADR-0063 calls "the skill boost of today".

## Context

A search has always put a skill before a document that matches as well: the rank the words give a skill was multiplied by 1.5. When the search by meaning came, the fusion of the two lists kept "the skill boost" by multiplying a skill's fused score by 1.5 as well (ADR-0063, point 5). So a skill was boosted twice wherever words and meaning were fused: once in the order of the words' list, and once more on the sum.

The two do not weigh the same. In a list ranked by words, 1.5 is a factor on a score. In a fusion by reciprocal rank a place is worth 1 / (60 + rank), next places differ by a sixtieth, and 1.5 is worth thirty places: a skill the words and the meaning both put thirtieth stood before the document both put first.

Measured on three packs read as a deployment reads them, two that hold skills and one of documents alone (395 findable entries, 29 of them skills, the heads of ADR-0094 embedded), with questions whose answer is known: 28 that ask for a skill and 24 for a document, asked across the packs, and inside the pack that holds the answer the same 28 and 32 more that ask for a document of a pack that holds skills.

| Across the packs | Skill asked for: first of 28 | in the first three | Document asked for: first of 24 | in the first three | A skill stands first for a document question |
|---|---|---|---|---|---|
| Boosted twice, 1.5 (as it was) | 21 | 27 | 2 | 7 | 16 |
| Boosted twice, 1.05 | 21 | 26 | 6 | 17 | 8 |
| Boosted once, 1.5 | 22 | 27 | 2 | 11 | 15 |
| Boosted once, 1.1 | 22 | 26 | 7 | 18 | 7 |
| **Boosted once, 1.05** | 22 | 26 | 8 | 18 | 3 |
| Boosted once, 1.03 | 21 | 26 | 11 | 18 | 0 |
| No boost | 13 | 24 | 11 | 18 | 1 |

| Inside the pack | Skill asked for: first of 28 | in the first three | Document asked for: first of 32 | in the first three | A skill stands first for a document question |
|---|---|---|---|---|---|
| Boosted twice, 1.5 (as it was) | 22 | 28 | 0 | 11 | 32 |
| Boosted twice, 1.05 | 22 | 28 | 3 | 25 | 26 |
| Boosted once, 1.1 | 24 | 28 | 1 | 23 | 28 |
| **Boosted once, 1.05** | 24 | 28 | 6 | 25 | 23 |
| Boosted once, 1.04 | 24 | 27 | 15 | 25 | 12 |
| Boosted once, 1.03 | 23 | 27 | 15 | 25 | 12 |
| No boost | 14 | 25 | 17 | 25 | 9 |

Three things read the same in both tables, and in a third reading taken on a deployment's own packs.

- **The boost was far too high.** A question about a document was answered with a skill first nearly every time, and inside a pack that holds skills every time.
- **Some boost is needed.** Without one the skill asked for is first for a little over half as many questions. A skill and a document often have the same sum of places, the one second by words and fourth by meaning, the other the reverse, and the boost is what decides between them.
- **Boosting once is better than boosting twice at every factor.** The words' own boost moves a skill up the words' list before the fusion counts its place there, which the fusion then boosts again; without it the skills lose nothing and the documents asked for rise.

What ADR-0094 left open beside the boost was measured with it, across the packs: fusing the order of the parts picked (ADR-0092) into the order by meaning, and taking fifty entries by meaning in place of the entries of the fifty nearest sections. Each cost the skills asked for two to four first places at the same boost, and neither brought a document into the first three that was not there.

## Decision

1. **A skill is boosted in one place: where the results of a search are put in one order.** That is the fusion by reciprocal rank (`fuseRanks`), in the reader for a search inside a mount and in the search across packs. The words rank a skill as they rank a document: the statement of a deployment, the statement across packs and the index in memory of the command no longer multiply a skill's rank.
2. **The boost is 1.05** (`SKILL_RANK_BOOST` of `@skillcdn/core`), inside a pack and across the packs alike. A skill passes the documents the lists place up to three ahead of it, and stays behind one that is further ahead.
3. **The words answering alone are put in order the same way**, as the one list there is: where a deployment has no model, where the model did not answer, and for a query of identifiers alone (ADR-0079). The same rule then orders every answer, and a skill is three places ahead with or without a model.
4. **The order by meaning stays the order of the nearest sections.** The order of the parts is not fused into it, and the meaning brings the entries of its nearest sections as before.

## Consequences

- A question about a document is answered with the document far more often, and a question about a skill with the skill as often as before or more: the rows in bold above.
- Inside a pack that holds skills, a skill still stands first for most questions about a document, with the document in the first three. A factor of 1.04 and below would put the document first for more than twice as many, and costs the skill asked for a place in the first three, inside a pack and across the packs; the first three are what a model reads, so the factor that keeps them was chosen. The factor is one constant, and the measurement is repeated when the packs or the model change what it was taken on.
- The order of a search by words alone changes where a skill and a document match about as well: the document may now come first. Nothing is indexed again.
- An adapter of the `IndexStore` port answers `search` in the words' order with no boost of its own. One outside this repository that boosted skills itself would boost them twice.
- The measurement kit is not in the repository: it reads a deployment's database. What stays here is the rule, and the tests that hold it (a skill three places behind a document passes it, one four behind does not).
- Rejected: a boost of its own for the search across packs (the two readings ask for nearly the same factor, and one rule is what a result can be explained by). Rejected: no boost (see the tables). Rejected: keeping the words' boost and lowering the fusion's alone (worse at every factor).
