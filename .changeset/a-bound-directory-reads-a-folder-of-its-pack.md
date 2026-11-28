---
"@skillcdn/cli": patch
---

In a directory bound to a pack (`skillcdn use`), a read no longer takes a bare word for a pack because a directory of that name is here. `skillcdn browse marketing/ads` read the directory `marketing/ads` as a pack of its own, with paths from that folder, where the folder of the bound pack was asked for; `skillcdn file docs` was a usage error; and `skillcdn find docs guide` searched the directory `docs` for "guide". In a checkout bound to its own pack every folder of the pack is such a directory. A bare word there is now the command's own argument, and another pack on this machine is written as a path, `./<name>`. Where nothing is bound, a directory named first is the pack, as before.
