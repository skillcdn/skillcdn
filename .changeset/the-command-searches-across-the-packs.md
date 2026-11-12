---
"@skillcdn/cli": patch
"@skillcdn/core": patch
---

`skillcdn search <words...>` finds the pack to read when none is known: what the words find across every public pack a deployment serves (ADR-0070), each result under the address of its pack, which `skillcdn skill`, `file`, `browse` and `find` take first. `--limit` up to 20, `--url` or `SKILLCDN_URL` for a deployment of your own, `--json` for the answer of `GET /api/v1/search`; no token is sent, since the search covers public packs alone. It answers `1` at a deployment without such a search and `2` when the search did not answer in time. In `@skillcdn/core`, `renderHubResult` takes the words of the reads as an optional third argument and then says how a pack is read by its address in place of where to connect; without it the text is what it was.
