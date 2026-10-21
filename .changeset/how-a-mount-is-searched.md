---
"@skillcdn/core": patch
---

How a mount is searched is part of what it says of itself (ADR-0064): the `mounts` body's ready index carries `search`, whether a search uses the vectors of its sections (`meaning`) and where the embedding of the index stands (`embedding`: `null`, complete, or `embedded` of `total` documents), `MountOverview` and `MountCatalog` carry the same as `MountSearch`, and the connection instructions say in one line what `search_repo` matches, original words or words and meaning, so that an agent asks in the pack's words or in its own. `IndexStore` may answer `embeddingProgress()`; `EmbeddingProgress` and `MountSearch` are exported. A deployment without an embedding model says words alone, as before.
