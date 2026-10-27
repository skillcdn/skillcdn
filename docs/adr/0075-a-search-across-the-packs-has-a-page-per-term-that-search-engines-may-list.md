# ADR-0075: A search across the packs has a page per term that search engines may list

- Status: Accepted
- Date: 2026-10-27
- Builds on [ADR-0070](0070-a-deployment-is-searched-across-every-pack-it-serves.md) (the search across every pack, over MCP and REST), [ADR-0028](0028-the-front-page-and-the-explorer-are-operator-content.md) (the front page and the explorer as operator content) and [ADR-0050](0050-the-pages-tell-analytics-only-what-is-public-and-usage-is-counted-in-the-database.md) (what the pages tell analytics).

## Context

A deployment is searched across every pack it serves, but only an agent could ask: the pages had no box for it. A person who comes to the front page wants to type what they want to make and see the skills and documents that do it, in the packs they come from; a search engine should be able to send them there for the terms people search for. A page of results is also the one page of the site that a stranger can make the deployment work for, since every term is a search over every pack, and a deployment should stand up to a burst of them without configuration of what sits in front of it.

## Decision

1. **The results of a term are a page of their own: `/search/<term>`.** The term is one path segment, written one way: trimmed, its whitespace collapsed, control characters out, cut to a length. The box submits `/search?q=`, which the server answers with a redirect to the page of the term, as it answers any other spelling of the term; `/search` alone is the page of the box. The page is rendered on the server with the results, as the page of an address is, and the browser takes over from there.
2. **A page of results is listed by search engines when it has enough to show**: three results or more, as its results were there to render. With fewer, with none, or while the results are not there, it is a page like any search, with its title and `noindex`. The sitemap lists the pages of the terms the operator names (`SEARCH_SITEMAP_TERMS`) and nothing else; the front page offers the search to search engines as a search action.
3. **An answer is kept, and shared.** The deployment keeps the answer of a search in each process for a configured time (`SEARCH_CACHE_SECONDS`, `SEARCH_CACHE_ENTRIES`) and tells a cache in front of it the same, on the page and on `GET /api/v1/search`; the same question asked twice at once is answered once; and only so many searches run at once in a process (`SEARCH_CONCURRENCY`), the rest refused with `503` and a time to come back. What is in front of the deployment, and how it limits a client, stays its own and out of this repository.
4. **The term stays on the page.** Analytics are told that a search happened and whether it found anything, never what was searched for; nothing is kept of what visitors typed.
5. **A deployment chooses the sections of its front page.** The front page leads with the search box and shows, after it, the sections a deployment names (`LANDING_SECTIONS`): the organizations working with it, the showcase of real results, the console, the three steps, the packs, the builders, the questions and the last call, in that order; unset, all of them. The server writes the choice, and whether the search is there, into the head of every page, and the pages render accordingly on the server and in the browser alike. A showcase entry may link to the result it shows and say whose work it is, a pack's or a builder's, and organizations are named beside the entries, all written through the admin API as the showcase is.

## Consequences

- A person types what they want to make and gets the skills and documents that do it, each with the pack it is in, what that pack is (a pack of skills, a pack of documents, or a repository read without a manifest) and whether it is vouched for; a search engine lists the terms worth listing and no more.
- A cache in front of the deployment answers the second visitor to a term; within a process the database is asked once per term per period, and a burst of different terms is bounded by the concurrency, not by the database. A term that finds nothing is kept too, for as long as any other.
- The front page of a self-hosted deployment can be the search box and the packs alone, with no mention of a program it does not run; the reference deployment shows everything.
- Rejected: results as a query string alone (`/search?q=`), which search engines do not list and caches key poorly; listing every term that was ever searched, which would index what visitors typed; and a results page without server rendering, which a crawler reads as empty.
