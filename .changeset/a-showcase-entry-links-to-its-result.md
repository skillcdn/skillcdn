---
"@skillcdn/core": patch
---

A showcase entry may carry a `link` to the result it shows and an `origin`, `pack` or `builder`, saying whose work it is, and the showcase may name `organizations` beside its entries; an operator may upload a PDF as media for such a link. A result of the search across packs says what its `pack` is: a pack of skills, a pack of documents or a repository read without a manifest, whether it is verified, how many skills it holds, and its owner's picture. The paths of the search pages and the sections of the front page an operator may leave out are shared from here: `SEARCH_PAGE_PATH`, `searchPagePath`, `searchTermOfPath`, `normalizeSearchTerm`, `LANDING_SECTIONS` and `parseLandingSections`. Every new field is optional on the wire, so an older answer still reads.
