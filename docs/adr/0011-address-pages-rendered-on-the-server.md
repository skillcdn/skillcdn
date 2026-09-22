# ADR-0011: The page of an address is rendered on the server and may be indexed

- Status: Accepted
- Date: 2026-09-22

## Context

ADR-0009 prerenders the static pages per language and leaves the view of an address to the browser, marked `noindex`, until there is a policy for what may be listed. The pages that people will actually search for are those of repositories: a popular repository should be found by its name and by what its skills do, in every language, and by the crawlers behind answer engines, which run no scripts. The server already has everything such a page shows, because it is what the REST API answers.

## Decision

1. **The web build brings a render module.** Besides the prerendered pages, `apps/web` builds `render/entry-server.js`, a self-contained module, and keeps the document template next to it. The manifest names both. The server imports the module once at startup and calls it per request for the view of an address; a build without it gets the shell as before. The server still knows nothing about the UI: it hands over the language, the origin, the URL and the answers the page would have asked the API for.
2. **The page is rendered with its data.** Serving it resolves the address and starts indexing, exactly like the API. The answers travel with the page in a JSON element, so the browser renders what the server rendered and takes over from there instead of asking again.
3. **What may be indexed.** The overview of an address without a ref, and one skill of it, once the index is there. Everything else says `noindex`: an address with a ref (a snapshot of the same page), a file, a search, a page whose index is being built or failed. The canonical URL of an indexable page is its own URL in its language, and the languages point at each other.
4. **What the sitemap lists.** The static pages, the featured addresses, and the repositories that the most distinct clients used over the last thirty days, at least two of them. One client is not popularity, and would let anyone put a repository into the sitemap by asking for it once. `robots.txt` keeps crawlers out of `/api/` only.
5. **The status is honest.** A repository that does not exist is a `404` page, a forbidden one is what the API says it is, so that search engines do not index an error as a page.

## Consequences

- Repository pages are complete HTML with title, description, canonical and alternate links and structured data, in each language, before any script runs.
- The web root is code, not only content: the render module runs in the server process. Only ever point `WEB_ROOT` at a build made from this repository.
- Every page of an address costs what the API call behind it costs, plus rendering. It is served with `vary: accept`, revalidation and an ETag, so a cache in front can hold it by URL.
- Rejected: leaving pages to the browser and trusting crawlers to run scripts (most of the ones that matter for answers do not); rendering with a second server process (one more deployable, for what is a function call); listing every indexed repository in the sitemap (anyone could fill it).
