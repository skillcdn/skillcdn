---
"@skillcdn/serve": patch
---

`server/discover`, `tools/list` and `prompts/list` can say how long a client of the current protocol revision (2026-07-28) keeps them ([ADR-0127](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0127-discovery-and-the-lists-say-how-long-a-client-keeps-them-and-whose-they-are.md)). They left with `ttlMs: 0` and `cacheScope: private` whatever the mount was.

- **`createMountServer` takes `surfaceTtlMs`** in its dependencies, in whole milliseconds. `tools/list` and `prompts/list` are kept that long. `server/discover` is kept as long as the mount's ref is trusted (`trustedUntil`), five seconds while the commit is not indexed or another index answers for it, and never longer than `surfaceTtlMs`.
- **`createHubServer` takes `surfaceTtlMs`** for its `tools/list` and its `server/discover`, with `cacheScope: public`. Where `packs` fails, its discovery says to keep nothing.
- **`SURFACE_TTL_MS`** is the hour a deployment gives both.
- `cacheScope` of the three follows the mount's `visibility`, as the results of the skills extension do.

Left out, `surfaceTtlMs` is 0 and the three say to keep nothing, as before: `createLocalApp` and `serveOverStdio` give none. The answers of the earlier protocol revisions do not change.
