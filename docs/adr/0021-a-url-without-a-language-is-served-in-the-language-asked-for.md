# ADR-0021: A URL without a language is served in the language the request asks for

- Status: Accepted; amends point 4 of ADR-0009 and point 4 of ADR-0013
- Date: 2026-09-24

## Context

ADR-0009 and ADR-0013 gave the server one rule: a URL without `?lang=` is the default language, and the browser shows the visitor's language by rendering the page again. A link-preview crawler runs no script. A link a Korean reader copied from the address bar was previewed in a Korean messenger in English, title, description and picture alike, although the crawler's request can say which language it wants. The same rule sends every browser that reads another language a page it then renders again.

## Decision

1. A URL whose parameter names a language the build has is served in that language, whatever the request asks for. Nothing about it varies.
2. A URL without one is served in the first language of the request's `Accept-Language` that the build has, matching a tag or its primary subtag, by weight and then in the order written; else in the default. The response says `Vary: Accept-Language`, `Content-Language` says what was chosen, and the URL is not changed.
3. A page served that way is the page of its language: its canonical URL, `og:url` and alternates point at that language's own URL, so search engines still see one URL per language, and the clean URL stays `x-default`.
4. The browser still shows a URL without a language in the visitor's preference (ADR-0013). It renders the page again only when that preference differs from the language the server chose, which the page records on its root element.
5. A static host, which cannot read the request, serves the default language, as before.

## Consequences

- A link preview follows the language of the crawler's request; a crawler that sends none gets the default.
- A browser that reads a language the build has gets that language from the server, and hydrates it.
- A page without the parameter can only be cached by a cache that honors `Vary: Accept-Language`; one that ignores it must not cache such pages. Pages with the parameter, and every file, are cached by URL as before.
- Search engines crawl without the header or with the default language, so what they index does not change.
- Rejected: guessing the language from a crawler's name (a user agent says which app asks, not which language its user reads). Putting the parameter in the address bar of visitors who read another language (a copied link would force it on everyone, which ADR-0013 undid).
