# ADR-0013: A URL without a language is shown in the visitor's language, and the URL stays as it is

- Status: Accepted; amends point 4 of ADR-0009
- Date: 2026-09-22

## Context

ADR-0009 gives every page one URL per language: `?lang=ko` is the Korean page and a URL without the parameter is the English one, so that every URL has exactly one representation and can be cached and crawled as such. To show a visitor their own language, the browser redirected a visitor without an explicit choice to the URL of their language before the first paint, and every link inside the app carried the language on. The consequence was that the parameter followed a Korean reader through the whole site, and a link they copied forced Korean on whoever received it. A link should open in the reader's language, not in the sender's.

## Decision

1. **A URL without a language is shown in the language the visitor prefers**, that is, the one they chose last, else the first supported language their browser reads, else the default. The URL is not changed to say so: it is the same clean URL for every reader, and each reads it in their own language.
2. **A URL with the parameter forces that language**, whatever the visitor prefers, and links inside the app carry it on, so a forced page stays forced wherever it leads. That is what crawlers follow, what `hreflang` and the sitemap point at, and what a person shares when they mean a language.
3. **Choosing a language in the switcher sets the preference** and shows the page at its plain URL in that language. The switcher's links remain real links to the forcing URLs, for crawlers and for opening in a new tab.
4. **The server and the prerenderer still know only the parameter.** A URL without one is the default language to them: one URL, one representation, unchanged from ADR-0009. Showing another language is the browser's work: a page prerendered in the default language is kept hidden by the boot script until the app has rendered it in the visitor's language, and shown anyway after a moment should the app never arrive.

## Consequences

- Copied and shared links carry no language, so they open in each reader's language. A language can still be forced by adding the parameter.
- A visitor who prefers a language other than the default pays a client render on every page they open from a clean URL, instead of hydrating prerendered HTML in their language. The answers the server rendered the page with are reused, so nothing is loaded twice; only the HTML is redone.
- Caching, crawling and canonical URLs are exactly as before. Search engines see the default language at clean URLs and every other language at its forcing URL.
- Rejected: negotiating the language on the server from `Accept-Language` (rejected in ADR-0009, for the same reasons). A cookie the server reads (the same cache problem). Keeping the redirect and stripping the parameter from links only (the address bar would still carry it, and that is what people copy).
