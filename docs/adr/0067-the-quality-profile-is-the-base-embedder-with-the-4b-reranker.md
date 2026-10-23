# ADR-0067: The quality profile is the base embedder with the 4B reranker

- Status: Accepted
- Date: 2026-10-23
- Builds on [ADR-0065](0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md) (point 4, the two profiles and the alternatives) and [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) (point 10, the evaluation set); changes what ADR-0065 point 4 names as the quality profile, and nothing else of it.

## Context

ADR-0065 chose the Qwen3 embedding and reranking family and named two profiles: *base*, the 0.6B embedder with the 0.6B reranker, for CPUs; *quality*, the 4B embedder with the 4B reranker, for a GPU. It chose them on four criteria and asked for the evaluation set to decide, and said the reranker may be absent from a deployment.

The first measurement, on the handbook of the first evaluation set in English and Korean, showed meaning lifting the first result from 81% to 93% of the questions, no reranker adding anything, and the 4B embedder in four bits equal to the 0.6B. The 4B reranker could not be measured for want of a GGUF converted by a llama.cpp that knows the reranker.

The second evaluation set is a library in six languages, in the vocabulary of research and defense documents, with questions in other words than the document, in another language than it, and with a code of it verbatim ([the evaluation sets](../../apps/server/fixtures/retrieval/README.md)). Both sets were run again on 2026-10-23 with the 4B embedder in eight bits, the 4B reranker from a current conversion, and two candidates under MIT, harrier-oss-v1-0.6b and harrier-oss-v1-270m ([what the models measured](../../apps/server/fixtures/retrieval/README.md#what-the-models-measured)). What they showed:

- On the second set every embedder alone reaches the first answering document for 54% to 56% of the questions, and for 75% to 82% with a reranker; the questions in another language than their document go from 6% to between 67% and 94%; the codes asked verbatim, which the fusion of words and meaning pushes down, come back with a reranker. On the first set a reranker changes a question or two. The reranker is the lever where a pack is multilingual or full of codes, and harmless where it is not.
- The 4B embedder equals the 0.6B embedder on both sets, in eight bits as in four, and costs four to five times the embedding time; on a GPU of 8 GB that the desktop shares it ran starved of memory. The 4B reranker is two to three points better than the 0.6B reranker on the second set and one question on the first, at four to five times the time of a search: a second on this GPU.
- KURE-v1 is the best embedder alone on both sets, and with a reranker the best configuration measured: with bge-reranker-v2-m3, 82% of the second set first and 98% on the page at a quarter of a second. harrier-oss-v1-0.6b is the best embedder within one language and on codes, and the worst across languages. harrier-oss-v1-270m ranks below the words alone as converted here.
- On a CPU the 0.6B reranker costs five to ten seconds a search and bge-reranker-v2-m3 two and a half to five, the more the longer the sections; on a GPU a quarter of a second each.

## Decision

1. **The base profile stays as ADR-0065 names it**: Qwen3-Embedding-0.6B with Qwen3-Reranker-0.6B, both in eight bits. The reranker is part of the profile wherever a GPU runs it, and left out of a deployment on CPUs alone, whose default is the embedder by itself; bge-reranker-v2-m3 with few candidates and a long timeout is the CPU's reranker where its seconds are affordable.
2. **The quality profile is the base embedder with Qwen3-Reranker-4B.** The 4B embedder is not part of it: two sets show it equal to the 0.6B embedder, and the vectors it makes cost five times the embedding time and the memory of a GPU for nothing measured. The 4B reranker runs in eight bits on a GPU with 6 GB free, and in four bits beside the embedder where 4 GB are; its GGUF is one whose header carries the reranking metadata (`qwen3.pooling_type`, `tokenizer.chat_template.rerank`), since a file converted before llama.cpp knew the Qwen3 reranker scores at random. A deployment that runs the quality profile over vectors made by the base embedder changes no vector: the two profiles share the embedder, and moving between them is a change of the reranker's configuration alone.
3. **Two alternative embedders are named beside KURE-v1**, both measured, both a change of configuration and a backfill as ADR-0065 point 5 has it: KURE-v1, MIT, as before, for packs that are Korean above all and for whoever wants the best numbers measured, at the cost of an input of 8192 tokens and no instruction; and harrier-oss-v1-0.6b, MIT, with the same architecture, pooling, dimensions and instruction as the base embedder, for packs that are each in one language and full of codes and designations, where it keeps what the Qwen3 embedder loses, at the cost of the search across languages, which it does not do. harrier-oss-v1-270m is not an alternative.
4. **The evaluation sets decide, and a deployment measures its own packs** with the same command before it changes a model. Which profile or alternative the hosted service runs is an operating choice and is not written here.

## Consequences

- The deployment documentation names the quality profile as the base embedder with the 4B reranker and gives the files and the memory each needs; the compose bundle changes nothing, since the reranker's file and the GPU are already variables of its overlays.
- A deployment that ran the 4B embedder keeps working: the vectors are keyed by model, and ADR-0065 point 5 says how a change of embedder is backfilled. Nothing here forces one.
- The evaluation set's page keeps the numbers of every configuration measured, so that the next candidate is compared against them rather than against this text.
- The adapters, the ports and the configuration are untouched: the decision is which files a deployment serves.
