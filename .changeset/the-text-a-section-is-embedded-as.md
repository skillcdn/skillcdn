---
"@skillcdn/core": patch
---

Adds `embeddingTextOf`, the text a section is embedded as for the search by meaning (ADR-0064): the document's title and the heading path, then the body without its heading line, which `sectionBody` gives on its own. The same text is embedded wherever the vectors are made, so that a deployment and the command find the same sections by the same query.
