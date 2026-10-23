# The retrieval evaluation sets

Questions with the sections that answer them, asked of the fixture packs beside this directory, so that a change to the word rules, to the ranking or to a model is measured against numbers rather than judged by eye (ADR-0063). There are two sets: `questions.json`, asked of the `document-pack` fixture in [`../.repositories/document-pack/`](../.repositories/document-pack/), the handbook of a fictional product in English and of a fictional office in Korean; and `multilingual-questions.json`, asked of the `multilingual-pack` fixture in [`../.repositories/multilingual-pack/`](../.repositories/multilingual-pack/), the library of an invented federation in six languages, in the vocabulary of research and defense documents ([the second set](#the-second-set-six-languages-two-domains)).

A set holds one entry per question: its `id`, the `language` it is written in, the `query` as a person would type it, and `answers`, the sections that answer it, each as the repository-root `path` of the document and the `heading` path of the section as a search result names it. A question may have several acceptable answers when the pack says the same thing in two places. The second set adds to each question its `kind` and its `domain`, and to each answer the `language` of the document, so that the report can group by them. Some questions deliberately use other words than the documents (a synonym, an abbreviation), so that search by words alone does not score perfectly: that gap is what search by meaning is measured on.

What is measured, by `src/retrieval/evaluate.ts`, over the first page of five results:

| Number | Meaning |
|---|---|
| file@1 | The first result is a document that answers the question. |
| file@5 | A document that answers the question is on the page. |
| section@1 | For the answering document, the first section it names is the answering section. |
| section@2 | The answering section is among the first two it names. |

`src/retrieval.test.ts` runs both sets over their fixtures with the command's index in memory and holds the numbers at floors a little under what the lexical search reached when each set was written; `src/retrieval.int.test.ts` runs the first set against a deployment's index in PostgreSQL and checks that both answer the same. To see the numbers:

```sh
pnpm --filter @skillcdn/server run eval:search
pnpm --filter @skillcdn/server run eval:search fixtures/.repositories/multilingual-pack fixtures/retrieval/multilingual-questions.json
```

The lexical baseline of the first set, measured when it was written (2026-10, reading rules version 11):

| | n | file@1 | file@5 | section@1 | section@2 |
|---|---|---|---|---|---|
| en | 34 | 76% | 100% | 91% | 100% |
| ko | 25 | 88% | 100% | 76% | 100% |
| all | 59 | 81% | 100% | 85% | 100% |

The first set is small and its questions are written by the same hands as its documents, so the numbers say what search by words alone does on a pack that is written for it; they are the baseline the models of phase B are compared against, not a claim about search in general.

### The second set: six languages, two domains

The installations this project is also made for run on closed networks, and what they index is the documents of research institutes and of defense and public bodies: terms a layperson does not know, abbreviations, specification and stock numbers, material and chemical names, several languages, and English codes inside every one of them. The first set reaches none of that. The `multilingual-pack` fixture is such a library, invented from end to end: the Vendrel Federation, a fictional federation with six official languages, keeps the documents of one research institute and one formation of its fictional defense force per language, each written in that language about its own subjects, so that no document is a translation of another and every fact lives in one place. Forty-eight documents of eight to ten sections each, 478 sections in all, under `en/`, `ko/`, `ja/`, `zh/`, `de/` and `ru/`, every folder with a manifest declaring its language and a map.

Two domains, four documents of each per language. Research: laboratory access, samples and reagents, calibration and inspection cycles, reference materials, data handling tiers and the transfer across an air gap, procurement codes, publication clearance, safety, test methods, quality systems, cleanrooms, hazardous chemicals, gas cylinders and cryogenics, vacuum equipment, radiation and laser safety. Defense: maintenance levels, stock numbers and requisitions, test and evaluation, radio voice procedure, ammunition storage, range safety, requirements and acquisition, supply classes, vehicle inspection and fuel, field sanitation and water, map reading, communications equipment care, the vocabulary of C4I, ISR and electronic warfare, IFF and TACAN, training and evaluation, CBRN protection, standards and specifications, medical service and MEDEVAC, field camp power and water, quality inspection and acceptance, equipment storage and preservation, field fortification and camouflage, military transport and the fuel service. The rule for the defense documents is that they stay at the level that is public: the same kind of content is found in published field manuals and doctrine, on official sites and in press releases, in public standards, acquisition glossaries and ordinary books. The dispositions, strength or vulnerabilities of any real unit, non-public figures of any real system, real security, authentication or cryptographic procedures, real operations and real people are not in them, and every system carries an invented designation. Codes follow invented schemes (defense standards `VDS nnnn`, stock numbers with the bureau code 81, forms, sample and certificate numbers), each code in one document of the whole pack, and the ranges differ per language.

The 180 questions, 30 per language, are of three kinds. A `paraphrase` question (108) is in the language of its document and in other words than the section: an everyday word for the technical term, an abbreviation spelled out or the term abbreviated, the consequence of a rule instead of its words; these are what search by meaning is measured on in each language. An `exact-term` question (36) carries a code, a number, a form or a designation exactly as the document writes it; the words should win these, and the fusion with meaning must not lose them. A `cross` question (36) is written in another language than its document, with no code in it, six per document language and every ordered pair of languages used once; words alone cannot answer them, so what they measure is meaning alone. The documents were written by six runs from one brief, one language each; the questions by other runs that read only the documents, one run per language for the paraphrase and exact-term questions and one per domain for the cross questions; and two further runs checked every question against all 24 documents of its domain for a wrong or a shared answer. No hand that wrote a document wrote a question about it.

The lexical baseline, measured when the set was written (2026-10, reading rules version 11), by the language of the question, by kind and by domain:

| | n | file@1 | file@5 | section@1 | section@2 |
|---|---|---|---|---|---|
| en | 30 | 33% | 70% | 37% | 53% |
| ko | 30 | 60% | 73% | 40% | 53% |
| ja | 30 | 53% | 77% | 27% | 50% |
| zh | 30 | 43% | 73% | 50% | 60% |
| de | 30 | 17% | 40% | 13% | 23% |
| ru | 30 | 33% | 67% | 37% | 40% |
| paraphrase | 108 | 53% | 85% | 36% | 53% |
| exact-term | 36 | 42% | 78% | 61% | 75% |
| cross | 36 | 0% | 0% | 0% | 0% |
| research | 90 | 41% | 64% | 27% | 39% |
| defense | 90 | 39% | 69% | 41% | 54% |
| all | 180 | 40% | 67% | 34% | 47% |

What the words alone say here. Across languages they answer nothing, as expected: a cross question shares no word with its document, and the whole of that row is what meaning has to add. German reaches two questions in five and Russian two in three: these languages are read without a stemmer and without stop words, so a compound does not match its parts, an inflected form does not match another, and the function words of a question are matched like any other word, which lifts the maps and the long documents that repeat them above the answer. Japanese and Chinese are matched by pairs of characters and reach three questions in four, but name the answering section first for half of them or fewer: pairs match in many sections of a document, and the section named first is the one with the most matched words. The codes asked verbatim are on the page for three questions in four and first for fewer than half, although every code occurs in exactly one document: the ranking counts occurrences and knows nothing of rarity, so `VDS`, which every defense document repeats, outweighs the one `4205` next to it, and `Form` and the institute's name outweigh the number of the form. That is a property of the word rules, not of the set, and it is what the exact-term questions are there to measure as the rules or the ranking change. The English questions, written in other words on purpose, reach the page for seven in ten. The floors in `src/retrieval.test.ts` are a little under these numbers; the second set has not been run with the models yet.

### What the models measured

The two profiles of [ADR-0065](../../../docs/adr/0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md) and its two alternatives, run over the first set on 2026-10-21 with llama.cpp's server from GGUF files on one machine, an eight-core desktop CPU and a consumer GPU with 8 GB ([the inference server](../../../deploy/README.md#the-inference-server-and-the-model-profiles)), by `pnpm --filter @skillcdn/server run eval:search` given the servers (`--embeddings-url`, `--embeddings-model`, `--reranker-url`, `--reranker-model`, `--instruction`). The Qwen3 embedders took the query instruction of `.env.example`, KURE-v1 none; a reranker scored ten candidates with a timeout long enough to always answer. Percentages over all 59 questions, then the 25 Korean ones; the mean time of a search per question. One question is about two points.

| Configuration | file@1 | file@5 | section@1 | section@2 | ko file@1 | ko section@1 | search |
|---|---|---|---|---|---|---|---|
| words alone | 81% | 100% | 85% | 100% | 88% | 76% | 5 ms |
| base embedder, Qwen3-Embedding-0.6B (Q8_0), CPU | 93% | 100% | 90% | 100% | 100% | 84% | 106 ms |
| base, with Qwen3-Reranker-0.6B (Q8_0), CPU | 93% | 98% | 90% | 98% | 96% | 84% | 5.3 s |
| base embedder, GPU | 93% | 100% | 93% | 100% | 100% | 92% | 16 ms |
| base with its reranker, GPU | 93% | 98% | 93% | 98% | 96% | 92% | 0.4 s |
| quality embedder, Qwen3-Embedding-4B (Q4_K_M), GPU | 93% | 100% | 90% | 98% | 96% | 92% | 28 ms |
| quality embedder (GPU) with the base reranker (CPU) | 92% | 98% | 90% | 98% | 96% | 92% | 5.4 s |
| KURE-v1 (Q8_0), CPU | 95% | 100% | 95% | 98% | 100% | 96% | 42 ms |
| KURE-v1 with Qwen3-Reranker-0.6B, CPU | 95% | 100% | 95% | 98% | 100% | 96% | 5.4 s |
| base embedder with bge-reranker-v2-m3 (Q8_0), CPU | 93% | 98% | 90% | 98% | 100% | 84% | 2.5 s |
| KURE-v1 with bge-reranker-v2-m3, CPU | 95% | 100% | 95% | 98% | 100% | 96% | 2.3 s |

What it says. Meaning lifts the first result from 81% to 93% or more of the questions, and the Korean first result from 88% to 96% or more: the questions written in other words than the handbook are found. On this set no reranker adds anything: ten candidates rescored by Qwen3-Reranker-0.6B or by bge-reranker-v2-m3 leave the numbers where the embedder put them and once push an answer off the page (`en-30`), at five seconds a question on the CPU, past the default `RERANKER_TIMEOUT_MS`, and at half that with bge-reranker-v2-m3; on the GPU the same reranker answers in well under a second. The 4B embedder in four bits is the 0.6B's equal here, better on the Korean sections and worse on the English ones; its 8-bit file was not measured, and neither was the 4B reranker: no published GGUF of Qwen3-Reranker-4B was converted by a llama.cpp that knows the reranker, and one converted before scores at random, so the quality profile's reranker waits for such a conversion. KURE-v1 is the best embedder on this set, in Korean and in English alike, with no instruction to configure. Embedding the pack's 105 sections took the 0.6B embedder 27 seconds on the CPU and under a second on the GPU, KURE-v1 19 seconds on the CPU, the 4B embedder 4 seconds on the GPU. The same embedder on the two kinds of hardware ranks a question or two differently: that is the size of the noise.

What follows for a deployment. On a CPU: the base embedder alone, with no reranker configured, or one given `RERANKER_CANDIDATES` of four to six and `RERANKER_TIMEOUT_MS` of eight thousand if reranking is wanted anyway; where the packs are Korean above all, KURE-v1 without an instruction. On a GPU: the base profile whole, its reranker included, since it costs a fraction of a second there. These are what the first set shows on a handbook written for it; the second set, with its questions in other words, in other languages and with codes, is what the next measurement runs on.

Everything here is invented: neither pack describes a real product, company, institute, force, unit or person.
