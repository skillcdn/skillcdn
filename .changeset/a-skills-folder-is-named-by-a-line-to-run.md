---
"@skillcdn/core": patch
"@skillcdn/cli": patch
---

`skillcdn skill` names the skill's own folder by a line to run, `skillcdn browse <pack> <folder>` with the pack as it was given, where it printed the call of the tool (`skillcdn browse {"path":"..."}`), which a shell cannot run: in the line that says where the rest of a skill's supporting files are, and in the one that follows the linked files it did not resolve. `readPack` of `@skillcdn/cli` takes `browseFolder`, the line a program with commands of its own makes for a folder, `<words.browse> <path>` by default; `ToolWords` of `@skillcdn/core` takes the same. What an MCP client is told is unchanged.
