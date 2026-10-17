---
"@skillcdn/core": minor
---

The bodies of the REST API's address routes are built here from the reader's results (`mountBody`, `browseBody`, `findBody`, `skillOutcome`, `fileBody`, `directoryBody`), and read back as those results (`mountSummaryOf`, `catalogStateOf`, `browseResultOf`, `findResultOf`, `skillResultOf`, `fileResultOf`, `directoryResultOf`), so that a program on the REST API renders what an MCP client's model is given with the same renderers; `joinSkillPages` makes one skill of the pages it was read in. The `skills` and `files` answers name the `commit` they were read from. The outcomes of a read (`IndexNotReady`, `SkillLookup`, `FileLookup`, `IndexedFile`, `MountOverview`, `MountManifest`, `SkillListing`) are types of this package.
