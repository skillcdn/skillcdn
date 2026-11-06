---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/serve": patch
"@skillcdn/client": patch
---

The skills extension is data over REST too: `GET /api/v1/listing/<address>?cursor=` answers the skills a mount lists as `skills/list` lists them, each with its `uri`, its `frontmatter` and its served files with `digest` and `size`, and `?uri=` answers what one URI of the listing names, a skill with its assembled `SKILL.md` and the digest of it, a file as text or base64 bytes with its digest, or a directory's entries. What a program that installs skills into an agent's own folder reads, checking each file against its digest, without speaking MCP.

- `@skillcdn/core`: `SkillEntry`, `SkillResource`, `SkillsPage`, `Resource`, `ResourceEntry` and `ListedItem` are the extension's types, moved here from the reader; `restListingSchema`, `restListedSchema`, `restListedItemSchema` and `restListedSkillSchema` are the shapes, `listingBody` and `listedBody` the builders; `REST_ROUTES.listing` and `restPath("listing", address)` name the route.
- `@skillcdn/reader`: the types above are re-exported from core; `getSkill`, `readResource` and `readDirectory` answer with the `mount` summary they were read from, as `listSkills` does; and the `digest` of a read resource is spelled as the listing spells it, `sha256:` first, where it lacked the prefix.
- `@skillcdn/serve`: the `listing` route, counted as `rest/listing`, a skill asked for by its URI as a load of the skill and a file as a read of it; a URI that names nothing listed answers `404 listing.not_found`.
- `@skillcdn/client`: `listing(address, { cursor })` and `listed(address, uri)`.
