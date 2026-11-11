---
"@skillcdn/core": minor
"@skillcdn/indexer": minor
---

Breaking: a token joined by slashes or dots is a word of the search vector beside the words it joins (ADR-0078, reading rules version 14). `open/closed/held` is found by `closed` and `ops.intake.queue` by `intake`, as a hyphenated word has always been found by its parts; a part of a dotted token that is digits alone is no word of its own, so a section number or a version (`4.2.6`) stays one word, and a URL and an address stay as they were read. `searchLexemes` and `queryLexemes` answer the parts after the whole, so every position after such a token moves; an index built under an older version is rebuilt when it is next asked for, and served as it is meanwhile.
