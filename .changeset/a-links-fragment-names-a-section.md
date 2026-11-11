---
"@skillcdn/core": minor
"@skillcdn/indexer": minor
"@skillcdn/reader": minor
"@skillcdn/serve": minor
---

Breaking: the fragment of a link names a section, and a file read lists its references by file with what reads each section (ADR-0082, reading rules version 15). `guide.md#4.2.7` names the first heading of `guide.md` whose words, in lower case and joined by hyphens, are the fragment or begin with it where a word ends, with every section under it; the indexer keeps the offset and the length with the reference (`references[].section` of an index entry, of `FileReference` and of the REST `files` answer) and reports a fragment that names nothing as `fragment_not_found`. The text a `read_repo_file` result ends with changes from `- <href> -> <path> (<status>)` to `- <path>: <fragment> (offset N, limit M); ...`, a file once, up to twelve links and the count of the rest (`FileResult.referencesMore`); a skill's references are listed as before. `inspectMarkdownLinks` answers a reference's `fragment` and bounds the references by the files they name (`MAX_MARKDOWN_REFERENCES`, 200) and the links to them (`MAX_MARKDOWN_LINKS`, 2,000) in place of 200 links. `core` exports `sectionOfFragment`, `fragmentResolver`, `headingSlug` and `fragmentOf`.
