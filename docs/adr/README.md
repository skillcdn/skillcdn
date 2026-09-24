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
| [0015](0015-a-forced-language-holds-for-one-page.md) | A forced language holds for one page; links inside the app carry no language | Accepted |
| [0016](0016-without-a-manifest-a-repository-serves-its-skills-and-docs.md) | Without a manifest, a repository serves its skills and `docs`; the reading rules are versioned | Accepted |
| [0017](0017-a-forced-language-becomes-the-preference.md) | A language the URL forces becomes the visitor's preference, as a click in the switcher does | Accepted |
| [0018](0018-skillcdn-fields-in-skill-md-under-one-key.md) | What SkillCDN adds to `SKILL.md` lives under `skillcdn`: the files that come with the skill, and translations for people | Accepted |
| [0019](0019-the-operator-vouches-for-repositories-until-owners-can.md) | The provenance notice warns about what goes beyond the task; the operator vouches for repositories until owners can | Accepted |
| [0020](0020-a-check-role-reads-a-working-tree-with-the-indexer.md) | A `check` role reads a working tree with the indexer; whatever the indexer skips is reported everywhere | Accepted |
| [0021](0021-a-url-without-a-language-is-served-in-the-language-asked-for.md) | A URL without a language is served in the language the request asks for, and says it varies; `?lang=` still forces one | Accepted |
| [0022](0022-repository-paths-and-progressive-skill-loading.md) | Canonical repository paths, four paged tools, complete inherited rules, declared hidden skills and local Markdown references; partially supersedes 0012, 0014, 0016 and 0018 | Accepted |
