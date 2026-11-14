---
"@skillcdn/cli": patch
---

`skillcdn search` takes `SKILLCDN_URL` without `SKILLCDN_TOKEN`, as its help says: the search across packs sends no token, so the address of a deployment is all it needs. It used to refuse with "SKILLCDN_URL and SKILLCDN_TOKEN are taken together or not at all", which is the rule of the reads, where a token is sent.
