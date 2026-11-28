---
"@skillcdn/cli": patch
"@skillcdn/core": patch
---

The `skillcdn` command costs an agent less to read, and says what to run next as a line (ADR-0131).

- `skillcdn skills` lists the skills. The documents outside them are counted, with what reads them (`browse`, `find`), where every one was listed: the first read of a checkout is about a third shorter for a pack of skills, and a few lines for a pack of documents, which printed pages of paths.
- A page of `browse` and of `find` that ends before what it lists ends with the command that reads the next, with the pack and the options as they were given, and names no cursor; the listing of `skills` no longer names the cursor beside its command. What a client is told on connect says, in the command's output, that a long skill comes in parts.
- `skillcdn help` lists the commands under whom they are for (reading a pack, writing one, serving a directory, connecting) in 2,452 bytes, where it was 3,263. A word that is no command is answered with the names, and a misuse with a sentence and the usage lines of the command, where each printed a whole page.
- A command refuses an option it does not take, where an option of another command was read and dropped (`skillcdn browse --path docs` listed the root). A word where a command takes none, and an option without its value, answer `64`, a usage error, where they answered `70`.
- `readPack` of `@skillcdn/cli` lists the skills alone for `skills`, and takes `nextPart` for `browse` and `find` as well: a page then ends with the line it makes. `@skillcdn/core` adds `ToolWords.pageNext` and `FindResult.skillsAlone`. The REST API and the MCP surface are unchanged.
