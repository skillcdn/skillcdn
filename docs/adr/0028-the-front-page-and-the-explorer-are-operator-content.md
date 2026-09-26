# ADR-0028: The front page and the explorer are operator content, with the reference repository as the default

- Status: Accepted
- Date: 2026-09-26
- Extends point 2 of [ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md) (the featured list) and [ADR-0011](0011-address-pages-rendered-on-the-server.md) (what the server renders per request).

## Context

The front page led with one showcase written into the web build: a concept clip, the words around it and an example conversation, all for the reference repository; the explorer showed the same card above the operator's featured list. Changing what a deployment leads with meant a new build, and every deployment led with the same thing. An operator who runs the service for their own repositories needs to say what their front page shows, in their languages, with their own media, without touching the build. The front page and the explorer make different promises, so they need different lists.

## Decision

1. **The front page shows a showcase list of the operator's.** An entry names the address it leads to, the words of the card and of the example conversation in each language the operator writes, and its media: a poster, and optionally the clip, the clip as an animated image, the pictures the conversation attaches, and a picture for link previews. Entries are written, replaced and removed through the admin API (`/admin/v1/showcase/<id>`), read by everyone through `GET /api/v1/showcase`, and shown in order.
2. **Media is uploaded, stored under the hash of its bytes, and served immutably.** `POST /admin/v1/media` stores an upload in the database under its SHA-256, which is the name it is served at (`/media/<sha>`) with byte ranges and a long cache life; an upload that an entry uses cannot be deleted. The accepted types are a short list of video and picture types, and an upload has a size limit. The build, the operator's uploads and nothing else supply media to the pages; repository content never does.
3. **The explorer keeps its own list**, the featured list of ADR-0026, apart from the showcase.
4. **A fresh deployment shows the reference repository on both pages.** While the showcase is empty the front page shows the build's own showcase of the reference repository, made from the language packs and the media bundled with the web build; while nothing is featured, the explorer features the reference repository. Each default leaves the moment the operator writes an entry of that list; an operator who wants the reference repository next to their own entries adds it.
5. **The server renders the front page with the showcase**, as it renders the page of an address, so that crawlers and link previews read what a person sees, and hands the browser the same answer; `llms.txt` is rendered the same way. With an empty showcase the prerendered page answers.

## Consequences

- An operator changes what the site leads with in a few requests and no build: upload media, write an entry. The words can be in any language the pages have; a visitor is shown their language, else the default language.
- The example conversation is per entry and optional: an entry without one shows the build's own conversation with the build's own media, so that the page never plays one entry's clip under words about another.
- Media lives in PostgreSQL as file bodies do, which keeps a self-hosted installation at one stateful dependency; a process keeps recently served uploads in memory, bounded. The front page is a hero image, not a film: media of many megabytes is meant to be exceptional.
- The social-preview image stays the build's unless an entry brings its own. A host without the render module serves the prerendered front page and `llms.txt`, which show the build's own showcase.
- Rejected: seeding the default into the database at first migration (the `migrate` role would have to read words and media out of the web build, which a deployment without the web UI does not have); keeping the showcase card on the explorer (two pages, two lists); storing media outside the database (a second stateful dependency for a few files).
