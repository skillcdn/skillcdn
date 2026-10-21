---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
---

A repository manifest may keep the documents it governs out of the search by meaning (ADR-0064): `search: { meaning: false }` in `SKILLCDN.md`, read as `RepoManifest.search` and stored by the indexer in the manifest's front matter (`search`) when it says so, which `skillcdn check` reports. The `Entitlements` port gains the `embed` action, with `EmbedLimits` (bytes per repository, bytes per account and day) in its decision, and the `UsageSink` an `embedding` event with the tokens the model read, in `token`s, so that whoever operates a deployment bounds and meters what is embedded. The defaults in this repository allow everything and discard every event, as before.
