---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/indexer": patch
"@skillcdn/cli": patch
---

A page a read cuts ends at the end of a line. A file longer than one read carries was cut by the count of its characters, in the middle of a line: a row of a table drawn with characters, cut there, reads as a row whose other cells are empty. A page cut by the default length, or by the size a response may have, now ends after the last line that is whole in it, and `nextOffset` begins the next line; a `limit` that was asked for and fits is given as measured, since that is how a section is read. In `@skillcdn/core`, `pageOfText` takes `{ atLineEnd: true }` for it. `skillcdn check` says of a section longer than one read what to do with a long code block as well, and the format says that what an original sets in a fixed-width font keeps its alignment, every character at its column.
