# ADR-0131: The commands of the command are one table, its help is bounded, and a read ends with the line that reads on

- Status: Accepted
- Date: 2026-11-28
- Builds on [ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md) (the reads and the exit codes), [ADR-0108](0108-the-command-prints-what-a-host-shows-whole-and-a-long-skill-in-parts.md) (a long skill in parts), [ADR-0110](0110-the-reads-of-the-command-are-a-library-for-other-commands.md) (the reads as a library) and [ADR-0124](0124-what-reaches-an-agent-is-bounded-in-bytes-on-either-route-and-a-part-says-what-a-page-says.md) (one read within what a host shows whole). It amends what `skillcdn skills` lists (point 1 of ADR-0055, and the listing of ADR-0124).

## Context

The command grew one command at a time to eighteen, in one list, and nothing said where the next would go or what it may cost whoever reads the help. Its readers are mostly agents, for whom every byte printed is context spent. Measured on the command as released and on the public reference pack:

- **The help was paid for more often than it was asked for.** The list with its paragraphs was 3,263 bytes. A mistyped command printed it whole, and a misuse printed the whole page of the command after one sentence, up to 1,687 bytes.
- **An option of another command was read and dropped.** Every command parsed with one set of options, so `skillcdn browse --path docs` listed the root and said nothing, and a word where a command takes none ended as an internal failure.
- **In a directory bound to a pack a folder was read as a pack** whenever a directory of that name stood there, which in a checkout bound to its own pack is every folder.
- **What a read said to do next was not always a line to run.** A long skill and the listing ended with the command that reads on. A page of a folder or of a search named a cursor and left the command to its reader; the listing named the cursor and the command; a skill named its own folder as the call of a tool.
- **`skillcdn skills` listed every document.** It is the first read an agent makes in a checkout. For the reference pack it printed 27,987 bytes and left 42 documents to a second page; for a pack of documents alone it printed two full pages of paths, where what a client is told on connect, printed above them, already names the folders and the page to start from.

## Decision

1. **The commands are one table.** A row says whom a command is for, what follows its name, one line of what it answers and the options it takes. The list `skillcdn help` prints, the options a command refuses and the names a word that is no command is answered with are read from it. The groups are the readers: reading a pack, writing one, serving a directory, connecting.
2. **A command is added as a row, a page of help and a case of the dispatch**, in the group of whoever runs it, and takes the options its row names. Commands for someone who neither reads nor writes a pack, the operator of a deployment first, are not rows of this list: they stand under one word of their own (`skillcdn <word> <verb>`), which takes one line of the list and has a list of its own, so that what every agent reads does not grow with what one operator uses. Nothing of that is built before the first such command.
3. **The help is bounded, and tests hold the bounds.** The list, with what holds for every command, stays within 2,600 bytes, and a command's page within 1,900. What one command needs alone is said on its page; a paragraph or a command past a bound makes room first.
4. **A mistake is answered with a sentence, not a page.** A misuse prints what was wrong, the usage lines of the command's page and where the rest is; a word that is no command prints the names. An option another command takes is a misuse, and so is whatever the parser refuses: all answer `64`.
5. **The grammar is `skillcdn <command> [<pack>] [<argument>] [--options]`.** The pack comes first when one is given. In a directory bound to a pack a bare word is the command's own argument, and a pack on this machine is written as a path, `./<name>`.
6. **What a read prints to be run is a whole line**, with the pack as it was given and where it is read: the next part of a skill, the next page of the listing, of a folder, of an outline and of a search, and the skill's own folder. A page printed for a reader of a command names no cursor. The lines are made by whoever names the reads (`nextPart` and `browseFolder` of `readPack`, `loadNext`, `pageNext` and `browseFolder` of `ToolWords`), so that a program with commands of its own prints its own.
7. **`skillcdn skills` lists the skills.** The documents outside them are counted, with what reads them: `browse` for a folder with what it holds, `find` for what they say.

## Consequences

- **The help costs less where it is read most.** The list is 2,452 bytes, a mistyped command about 230 where it was 3,285, and the misuse of `skill` about 290 where it was 1,472.
- **The first read of a checkout is shorter.** `skillcdn skills` prints 17,187 bytes for the reference pack, on one page, and 1,688 for a pack of 147 documents, where it printed two pages.
- **A command line that passed an option its command does not take now fails**, where the option was dropped; and a word where none is taken, or an option without its value, answers `64` where it answered `70`.
- **A program that prints the listing through `readPack` lists the skills alone** once it takes the version, and a page of a folder or of a search ends with its line where it passes `nextPart` for that read; without one the page names its cursor as before.
- **The REST API and the MCP surface are unchanged.** A search without words lists skills and documents as before, and a tool result names its cursor.
- **Rejected:**
  - nouns over the commands there are (`skillcdn pack skills`, `skillcdn auth login`): every checkout's agreement and every guide names the commands as they are, and the groups of the list give the order without renaming one;
  - a flag of `skills` that lists the documents as well: `browse` and `find` are that read, by folder and by words;
  - the whole page after a misuse: its reader asked for something else, and the page is one command away;
  - a table of options per command for the parser: the values would lose their types, and the check of a row is one place.
