# ADR-0033: A file over the read limit is named with its source, not held against its skill

- Status: Accepted
- Date: 2026-10-02
- Amends point 4 of ADR-0025: a file over the read limit no longer keeps a skill off the skills extension.

## Context

A skill can ship a data file larger than what this server reads and stores per file: a font index, a corpus, a generated table. Under [ADR-0025](0025-a-skill-on-the-wire-is-assembled-from-its-sources.md) one such file kept the whole skill off the skills extension, so a host that understands skills saw nothing of it, while the tools served the rest. The read limit also defaulted to 1 MiB, which real skills exceed with ordinary data files. `read_repo_file` refused such a file with its size and nothing else, and the same held for binary files, which the text route cannot carry at all. The bytes are at the git host in every case, at a URL the server can compute.

## Decision

1. **The default read limit is 2 MiB** (`READ_MAX_FILE_BYTES`). It remains configuration.
2. **A skill is served without the files over the read limit, and names them.** The listing holds every served file within the limit; the served `SKILL.md` carries one line per file left out, right after the line that names its sources, with the file's repository-root path, its size and the URL of its bytes at the host for the commit served. The digest of the document covers those lines. `load_skill` lists the same files with their source, and the skill carries a warning for the author. The left-out files do not count toward the extension's bounds of 512 files and 16 MiB.
3. **A refused read says where the bytes are.** `read_repo_file` and the REST files endpoint answer an oversized file, and a file that is not UTF-8 text, with the size or the reason and the URL of the bytes at the host.
4. **What was decided when the commit was indexed is what is served.** The index records the files left out of each skill with their source URLs, and a read assembles the document from that record, so that the bytes a host reads are the bytes the listing digested whatever the limit is at read time. A changed limit shows after re-indexing.
5. **Per-file limits do not make an index partial.** A file over the per-file indexing limit is listed and readable, not searched or summarized; a file over the read limit is named. The index is partial, and says so, when the tree, file-count or total-size limits leave entries out, or a declaration file is over the limit. `check` names the files that are too large to search.

## Consequences

- A host that implements the extension receives a skill with a large data file as every other skill, minus that file, and its `SKILL.md` says so where an agent reads first. A skill whose large file is essential works once the agent fetches it; one whose large file is incidental works as it is.
- A host that verified a skill sees its digest change when such a file crosses the limit in either direction, as it does for every other change to the document.
- Rejected: keeping the skill off the extension (a host saw nothing of a skill for one file it would not have read); serving a stub in the file's place (a host would install bytes that are not the file's, and a program reading the file would get them); listing the file with its real digest and proxying its bytes from the host on read (the index would declare bytes it does not hold, and a read would depend on the host at request time); listing the file as an `https` resource (hosts fetch skill resources from the server that listed them).
