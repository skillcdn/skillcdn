# The retrieval evaluation set

Questions with the sections that answer them, asked of the `document-pack` fixture in [`../.repositories/document-pack/`](../.repositories/document-pack/), in English and in Korean (ADR-0063). A change to the word rules, to the ranking or, later, to a model is measured against these numbers rather than judged by eye.

`questions.json` holds one entry per question: its `id`, the `language` it is written in, the `query` as a person would type it, and `answers`, the sections that answer it, each as the repository-root `path` of the document and the `heading` path of the section as a search result names it. A question may have several acceptable answers when the handbook says the same thing in two places. Some questions deliberately use other words than the handbook (a synonym, an abbreviation), so that search by words alone does not score perfectly: that gap is what search by meaning is measured on.

What is measured, by `src/testing/retrieval.ts`, over the first page of five results:

| Number | Meaning |
|---|---|
| file@1 | The first result is a document that answers the question. |
| file@5 | A document that answers the question is on the page. |
| section@1 | For the answering document, the first section it names is the answering section. |
| section@2 | The answering section is among the first two it names. |

`src/retrieval.test.ts` runs the set over the fixture with the command's index in memory and holds the numbers at a floor a little under what the lexical search reached when the set was written; `src/retrieval.int.test.ts` runs it against a deployment's index in PostgreSQL and checks that both answer the same. To see the numbers:

```sh
pnpm --filter @skillcdn/server run eval:search
```

The lexical baseline, measured when the set was written (2026-10, reading rules version 11):

| | n | file@1 | file@5 | section@1 | section@2 |
|---|---|---|---|---|---|
| en | 34 | 76% | 100% | 91% | 100% |
| ko | 25 | 88% | 100% | 76% | 100% |
| all | 59 | 81% | 100% | 85% | 100% |

The set is small and its questions are written by the same hands as its documents, so the numbers say what search by words alone does on a pack that is written for it; they are the baseline the models of phase B are compared against, not a claim about search in general.

Everything here is invented: the handbook describes no real product, company or person.
