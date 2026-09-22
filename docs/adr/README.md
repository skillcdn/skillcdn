# Architecture Decision Records

One short file per decision that has lasting consequences and that a future contributor might reasonably want to undo: a dependency the system is built around, a boundary between packages, a data-model choice, a security rule, a break in a public contract.

## Rules

- Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` using the next free number.
- Keep it under a page: context, decision, consequences. No essays.
- An accepted ADR is never edited, apart from its status line. To change course, write a new ADR and mark the old one `Superseded by ADR-NNNN`.
- If two changes take the same number, the one that lands second renumbers.
- This repository is public: no business reasoning, no operations details, no comparisons with other products.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-license-and-trademarks.md) | FSL-1.1-ALv2 license, separate trademark policy | Accepted |
| [0002](0002-toolchain.md) | Node.js 24, pnpm-pinned toolchain, compiled TypeScript packages | Accepted |
| [0003](0003-one-image-several-roles.md) | One deployable with `api`, `worker` and `migrate` roles | Accepted |
| [0004](0004-postgresql-only-state.md) | PostgreSQL as the only stateful dependency | Accepted |
| [0005](0005-public-repository-private-operations.md) | What lives in this repository and what does not | Superseded by 0008 |
| [0006](0006-mcp-sdk-v2-per-request-servers.md) | MCP SDK v2, one server instance per request | Accepted |
| [0007](0007-snapshot-rows-coordinate-indexing.md) | Snapshot rows coordinate indexing; the api role indexes lazily | Accepted |
| [0008](0008-repository-ends-at-an-image-that-builds.md) | This repository ends at an image that builds; publishing and deployment are outside | Accepted |
| [0009](0009-web-ui-prerendered-per-language.md) | The web UI is prerendered per language and served by the `api` role; `?lang=` selects the language | Accepted |
| [0010](0010-distinct-clients-by-daily-keyed-hash.md) | Distinct clients are counted by a keyed hash of the address under a key that dies with the day | Accepted |
| [0011](0011-address-pages-rendered-on-the-server.md) | The page of an address is rendered on the server with its data and may be indexed; the sitemap lists featured and popular repositories | Accepted |
| [0012](0012-what-a-client-is-told-and-offered.md) | The catalog travels with the connection; skills are prompts, documents are not resources, results stay text; the endpoint answers any origin | Accepted |
| [0013](0013-language-decided-in-the-browser-without-changing-the-url.md) | A URL without a language is shown in the visitor's language without the URL changing; `?lang=` forces one | Accepted |
| [0014](0014-the-repository-manifest-decides-what-a-mount-serves.md) | `SKILLCDN.md` names and describes a repository, states the rules of its skills, and decides what a mount serves | Accepted |
