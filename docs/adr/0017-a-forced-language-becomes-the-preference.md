# ADR-0017: A language the URL forces becomes the visitor's preference

- Status: Accepted; amends point 1 of ADR-0015 and point 3 of ADR-0013
- Date: 2026-09-22

## Context

ADR-0015 made the links inside the app carry no language and let a forcing URL (`?lang=ko`) hold for that one page. That left a gap. A visitor who arrived through a forcing URL, from a search result in their language or from the switcher before scripts had loaded, was back in their browser's language on the next page, and the only way to stay was to find the switcher. Someone who asked for a language, by the URL or by a click, asked for the site in that language.

## Decision

1. **A language the URL forces becomes the visitor's preference**, exactly as choosing it in the switcher does: it is stored in the browser, and every URL without a language is shown in it from then on. The boot script stores it before the first paint, the app applies it to the pages that follow, and links still carry no language (ADR-0015, point 2).
2. **The switcher replaces the preference**, whatever set it. The last choice wins, whether a URL or a click made it.
3. **The server still knows nothing of it** (ADR-0013, point 4). The preference lives in the browser's storage, never in a cookie the server reads, so pages stay cacheable exactly as they are.

## Consequences

- A visitor keeps the language they asked for across the site and across visits, until they ask for another.
- A shared link that carries `?lang=ko` sets the recipient's preference to Korean; one click in the switcher sets it back. A link copied from any page after the first carries no language (ADR-0015), so this takes a deliberately forcing URL.
- Rejected: keeping a forced language for the tab only (a second store to reconcile, and a visitor who returns is back where they started); a cookie (the server must not know the language, ADR-0009).
