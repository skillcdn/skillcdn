---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

A question about a document is answered with the document, where a skill used to stand first nearly every time (ADR-0095). A skill was boosted twice wherever words and meaning were fused, by 1.5 in the words' rank and by 1.5 again on the fused score, which in a fusion by reciprocal rank is worth thirty places. It is now boosted once, where the results are put in one order, and by 1.05: `SKILL_RANK_BOOST` of `@skillcdn/core` is 1.05, a skill passes the documents up to three places ahead of it, and the words rank a skill as they rank a document. The index in memory (`@skillcdn/reader`) and with it the `skillcdn` command answer `search` in the words' order without a boost, and the reader orders the words answering alone by the same fusion, so the order of `find` changes where a skill and a document match about as well. An adapter of `IndexStore` that boosted skills itself would now boost them twice.
