---
"@skillcdn/core": minor
---

The word rules of search, so that a pack indexed in memory is searched as a deployment searches one (ADR-0053): `searchLexemes` and `queryLexemes` cut and stem text as PostgreSQL's `english` configuration does, with `stemEnglish` (the Snowball English stemmer) and `ENGLISH_STOP_WORDS`; `searchFieldsOf`, `searchVectorOf` and `rankSearchVector` weigh and rank a document as the deployment's index does, with `SEARCH_WEIGHTS`, `SKILL_RANK_BOOST` and `MAX_SEARCHED_BODY_LENGTH`.
