# ADR-0032: The social preview of an address is drawn by the server

- Status: Accepted
- Date: 2026-09-27
- Extends [ADR-0011](0011-address-pages-rendered-on-the-server.md) (the page of an address is rendered on the server) and [ADR-0031](0031-a-picture-for-a-repository-comes-from-its-manifest-or-the-operator.md) (the owner's picture stands beside the name).

## Context

A link to the page of an address unfurled with the site's own card: the same picture for every repository and every skill, saying nothing about the one the link led to. Git hosts draw a card per repository for this, with its name, its description and its owner's picture, and a link that shows what it leads to is opened more. The pages had the words (the head already says them) and, since ADR-0031, the picture; nothing drew them.

The repository's own picture (`image`) could have been the card. It is any shape, it may be a logo on white or a screenshot, and a link preview crops it to two to one; a card drawn around the words is the same whatever the repository declares, and the maintainer chose that.

## Decision

1. **The server draws a card per address**, at `GET /social/<address>?lang=<language>[&skill=<path>]`: 1200 by 630, the ground of the pages, the owner's picture, what the page is, its name, where it is, its description, and a pill or two (how many skills, whether it is verified), with the site's mark. A skill's card carries the skill's title and description. The page of an address names its card as its `og:image`, with the page's language in the URL, so that a crawler gets the card of the page it read.
2. **The words come from the web build**, which has the language packs: the render module answers `socialCard(language, origin, data)` with what the card says, and the server draws it. A build without the function has no cards, and the pages keep the site's own picture. The faces the card is set in travel with the web build (`fonts/`), the same typeface as the pages, unmodified, under the notice that ships with it.
3. **Drawing is a native dependency of the server.** The card is rasterized with a canvas library shipped as prebuilt binaries for the platforms the image is built for, without install scripts, under a permissive license. It is the one piece of the server that is not pure JavaScript.
4. **The owner's picture is fetched by the server** for the card, and nothing else is: an `https` URL, without credentials, bounded in size and time, kept in memory for a while, and never served on. A repository's own picture is not fetched: the card does not show it.
5. **Cards are kept in memory** under everything they were made from (the language, the address, the commit, the skill, how far the index was), for a while and in a bounded number, and answered with a cache life of an hour, so that a burst of unfurls draws each once and a change to the repository shows within the hour.

## Consequences

- A link to a repository or a skill unfurls with its name, its description and its owner's picture, in the language of the page.
- The server fetches from the git host on behalf of a card, which it did not do before for pictures: one small picture per owner, kept, and nothing on a reader's behalf. The page of an address still loads pictures in the reader's browser.
- The image gains a native module and two font files; a platform the library has no binary for cannot run the `api` role.
- Rejected: the repository's picture as the card (any shape, cropped by whoever unfurls it, and empty for most repositories); rendering the card in the browser (a crawler runs no scripts); an SVG card (link previews want a raster); a pure JavaScript rasterizer (text shaping for Hangul is the hard part, and the ones that do it are copyleft or unmaintained).
