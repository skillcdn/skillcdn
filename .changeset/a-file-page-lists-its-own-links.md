---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

A page of a file lists the links within it, not the first links of the whole file: a section read by its offset and limit is no longer followed by references to other parts of the document. A page that delivered the length it was asked for says where the file continues ("The file continues at offset N.") instead of telling the reader that more follows, since a section read is complete at its end; "More follows" is kept for a page the response budget cut short of what was asked. The file result carries the requested length as requestedLength for the renderer to tell the two apart.
