# ADR-0009: The web UI is prerendered per language and served by the `api` role

- Status: Accepted; the shell for address pages in point 1 is amended by ADR-0011, and the redirect to the visitor's language in point 4 by ADR-0013; the rest of point 4, that the server never reads `Accept-Language`, is amended by ADR-0021
- Date: 2026-09-22

## Context

The web UI has a landing page and an explorer over what an address serves. It is published in more than one language, and its pages have to be found: by search engines, and by the crawlers behind answer engines, most of which do not run JavaScript. A page that only exists after a script has run is invisible to them, in every language.

Three more constraints come from the rest of the design. The product is one image that runs anywhere, so nothing about a deployment (its public origin, for one) may be fixed when the image is built. The `api` role sits behind caches we do not control, so a URL must always produce the same response. And an address such as `/gh/<owner>/<repo>` is what a person pastes into a browser as naturally as into an MCP client.

## Decision

1. **Static routes are prerendered at build time, once per language.** `apps/web` builds to static files plus a manifest that lists every prerendered route and its language variants. Routes that depend on data (the explorer view of an address) get a prerendered shell and render in the browser.
2. **The `api` role serves the build** when `WEB_ROOT` points at it, and stays a complete MCP and REST server when it does not. It reads the manifest; it knows nothing about the UI framework or about which languages exist.
3. **Every language uses the same paths. A query parameter selects the language** (`?lang=ko`); no parameter means the default language, English. Each variant is its own URL with its own canonical link, and all variants point at each other with `hreflang`, in the page and in the sitemap.
4. **The server never negotiates the language from `Accept-Language`.** One URL, one representation: safe behind any cache, and the same for a crawler as for a person. Adapting to the browser's language happens in the browser, before first paint: a visitor without an explicit choice whose browser prefers another supported language is sent to that variant's URL. The choice a visitor makes is remembered in the browser.
5. **The public origin is runtime configuration** (`PUBLIC_URL`). Prerendered pages carry a placeholder that the server fills in, and the server generates `sitemap.xml` and `robots.txt` from the manifest. One build serves any domain.
6. **An address answers browsers and agents alike.** `GET` on an address with an `Accept` header that asks for HTML gets the explorer; every other request on that path is MCP.
7. Language packs are the one place where committed text is not English.

## Consequences

- Crawlers get complete HTML, metadata, structured data and social-preview images in each language without running scripts.
- The UI stays optional and the server stays generic: a deployment without `WEB_ROOT` loses nothing else.
- Explorer pages for arbitrary repositories are not prerendered and are marked `noindex` for now. Making them indexable later means rendering them on the server, through the same seam (the server asks the web build for a page), and needs a policy for what may be listed.
- A plain static host can still serve the build, in the default language only, with the origin fixed at build time.
- Rejected: a client-only single-page app (invisible to most crawlers). A path prefix per language (the endpoints are meant to be identical across languages, and addresses must keep working as they are). Negotiating by `Accept-Language` on the server (a shared cache would serve one visitor's language to everyone). Running a separate rendering server (a second deployable for what is, today, a handful of static pages).
