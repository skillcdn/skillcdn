---
"@skillcdn/core": minor
"@skillcdn/indexer": minor
"@skillcdn/reader": patch
---

Breaking: a document made from the pack's documents says so, and its quotations are checked (ADR-0083, reading rules version 16). A document with `derived` in its front-matter (`kind`, `from`, `by`, `at`) is marked in the index (`frontMatter.derived`) and in a search result (`(made from other documents: quote what it points to)`, `derived: true` over REST); every block quote of it must end with a link to the section quoted, and the indexer holds the quotation against that section word for word, with links, markup and blanks folded on both sides and `…` for words left out. `check` and a deployment report `quote_not_in_source`, `quote_without_link` and `derived_from_missing`. `core` exports `documentDerivation`, `quotationsOf`, `quotationStandsIn` and `foldQuoted`.
