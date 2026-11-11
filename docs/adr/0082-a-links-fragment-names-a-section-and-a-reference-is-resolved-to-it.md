# ADR-0082: A link's fragment names a section, and a reference is resolved to it

- Status: Accepted
- Date: 2026-11-11
- Builds on [ADR-0063](0063-packs-of-documents-are-served-to-agents-through-structure-words-and-meaning.md) and [ADR-0081](0081-a-long-original-is-laid-out-by-its-own-numbers-in-sections-read-at-once.md); changes the sentence "Fragments are removed" of the format's Markdown references and the count of their limit.

## Context

A specification refers to itself by number, hundreds of times: "as 4.2.7 defines it". In a pack those references are links to the file that holds the clause, and a read of a file listed the links of its page as `href -> path`, the file and no more: to follow one, an agent read the file, or its outline and then the section. The fragment of the link, which says which clause, was dropped when the link was resolved.

Measured on a pack of two long specifications of an installation, over 746 links: the file a link names had a median of 13,000 to 21,000 characters, the clause it meant 3,000 to 4,000. With a proxy that answered the references of a page as sections with their offset and limit, the sessions read the named section instead of the file, and the whole-file reads of one class of model went from six to one. A link whose every row names another clause of the same chapter, as an index has them, counted each row as a destination and ran into the limit of 200 destinations per file.

## Decision

1. **The fragment of a local link names a section of the file the link points to.** It names the first heading of that file whose words, in lower case, each without the marks around it and joined by hyphens, are the fragment, or begin with it where a word of the heading ends: `#4.2.7` names `4.2.7 Detection of carrier loss` and not `4.2.7.1`, `#table-c-2` names `TABLE C-2 Modifier codes: AA to BZ`. The slug a git host's renderer makes of a heading, without the dots, names it as well, and so does an explicit anchor (`<a id="...">`), which names the section it stands in. A fragment plays no part in which file is linked, as before.
2. **The section is the heading with every section under it**, to the next heading of its level or above: a clause named by a reference comes with its sub-clauses, where the outline's own length for a heading ends at the first of them.
3. **The index resolves, once.** When a commit is indexed and every body is at hand, each reference with a fragment is given the offset and the length that read its section, for a target that is served; a file that is withheld says nothing of where its headings stand. The reading rules move to version 15. A fragment that names no section of a served file is the diagnostic `fragment_not_found`, one per source file.
4. **A read lists the links of its page by the file each names**: a file once, with the sections the links name in it and what reads each, `- <path>: 4.2.7 (offset 849, limit 2129); 4.2.8 (offset 3648, limit 610)`, up to twelve links and the count of the rest; a link without a fragment, or with one that names nothing, names the file. Over REST a reference carries `section`. A section is said only for a file that can be read at the mount.
5. **The limit counts the files.** A source file's references are bounded by the Markdown files they name, 200, and by the links recorded to them, 2,000, in place of 200 links: an index of two thousand rows into one chapter names one file.
6. **A link to a section of the same file is written with the file's name.** An anchor alone (`#4.2.7`) is not a reference of the repository, as before: it resolves in whatever renders the file, and the outline of the file gives its sections.

## Consequences

- A reference by number is followed with one read of the clause: on the specification pack of the fixtures every link with a fragment resolves, and the sections read are less than half of the files they stand in.
- The text a file read ends with changes: the references are grouped by file and no longer written as `href -> path (status)`; a status is said only when it is not `available`. Skills keep their list as it was.
- Every index is rebuilt under version 15 as it is next asked for and served from the old one meanwhile ([ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md)); an index of an older version carries no sections, and its reads list files alone.
- A pack whose links carry fragments for a renderer's anchors gets them resolved where the heading matches, and `fragment_not_found` where it does not: a pack that linked `#some-anchor` to nothing is told so.
- Rejected: resolving at read time (a read would fetch the bodies of every file its page links to, on every call); the outline's own length for the heading (a clause with sub-clauses would come as its first lines alone); a fragment grammar of our own with the heading's full text (a person writes `#4.2.7` by hand, and a number is what the text already says); raising the limit of links (the limit bounds the files a document can pull into what is read, which the count by file still does).
