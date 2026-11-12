---
"@skillcdn/core": patch
---

The ranking of a search can say that its words did not answer (ADR-0091). `FindRanking` and the `ranking` of the REST search answer gain the optional `words`, which a search across the packs of a deployment sets to `false` when the words of the query ran out of their time and the results are the nearest in meaning alone; `renderHubResult` then ends with `Ranked by meaning alone this time: the words did not answer in time, so a result only they would find is missing. Ask again for the full answer.` The field is left out wherever the words answered, so nothing that reads an answer today changes.
