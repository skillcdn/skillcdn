---
"@skillcdn/serve": patch
---

The REST routes mark every answer `cache-control: no-store` only where the route set no cache header of its own; a deployment's search across packs now says how long a cache may keep its answer, and that header stands.
