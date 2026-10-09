---
"@skillcdn/cli": patch
---

`skillcdn check` ends quietly when whatever reads its output stops early (`skillcdn check | head`), instead of failing with a broken-pipe error.
