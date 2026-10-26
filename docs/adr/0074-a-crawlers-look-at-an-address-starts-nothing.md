# ADR-0074: A crawler's look at an address starts nothing

- Status: Accepted
- Date: 2026-10-26
- Builds on [ADR-0011](0011-address-pages-rendered-on-the-server.md) (the page of an address rendered with what it serves), [ADR-0032](0032-social-previews-are-drawn-by-the-server-for-each-address.md) (the social preview), [ADR-0037](0037-an-account-has-a-page-made-from-what-the-git-host-shows-everyone.md) (the page of an account) and [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (the commit before, served in place of one not ready).

## Context

The page of an address is rendered on the server with what the address serves, so serving it resolves the address and starts indexing it, as the REST API does; so do its social preview and its badge. The page of an account lists the repositories the git host shows everyone, and the sitemap names the accounts of the repositories the operator lists. A crawler that reads the sitemap opens those accounts' pages and, through them, the page of every repository the first page of each lists; `rel="nofollow"` on those links did not keep the crawlers that came from following them. Every page they opened had the deployment ask the git host, index the repository and, where it held a `SKILL.md`, embed it unasked ([ADR-0072](0072-the-worker-embeds-the-packs-first-and-the-rest-when-asked.md)): on a public deployment most of what was indexed came that way, none of it asked for by a person or an agent. The maintainer chose this decision over the three below.

## Decision

1. **A request is a crawler's when its User-Agent says so**: a product name that ends in "bot", the words crawlers use (crawl, spider, slurp, scrap, preview), or the name of a link preview that uses none of them. A browser, a request that names nothing, a tool, and a fetch a person asked an assistant for, which names itself as such, are a person's.
2. **A crawler's look at an address starts nothing.** The page, the social preview and the badge it asks for are drawn from what the deployment holds of the repository: the commit's index when it is ready, else, as ADR-0068 serves it, the commit before. Neither the request nor the reading starts indexing, and a search in the page's URL is left to the browser, since it would embed its query and could queue an embedding.
3. **A crawler is not answered with what the git host knows.** For a name the deployment has not read, or a repository that is not public, the page is the one a browser gets before it asks the REST API, without the repository and not to be indexed, and the preview, the badge and the icon are `404`, all without a word to the host. A person taken for a crawler sees that page filled in through the REST API, which robots.txt keeps crawlers out of; a repository that is not public answers like a name never read.
4. **Nothing changes for people and agents.** Their first look reads a repository, the MCP endpoint and the REST API start indexing as before, the pages of accounts stay where search engines find them, and the sitemap lists what it listed.

## Consequences

- Crawlers no longer add repositories to a deployment: what is indexed is what people and agents opened, and what the operator lists. What crawlers indexed before stays until an operator removes it, which this does not do.
- A known limitation: the preview of a link to a repository nobody has opened on the deployment shows the site's own card, not the repository's; once a person has opened the link, its previews show the repository. No exception is made for previews, through which crawlers would start indexing again.
- A crawler that passes for a browser is taken for a person, as it passes robots.txt by; this stops the crawlers that say what they are. A crawler sees a moved branch at the commit read before until a person or an agent looks.
- Rejected: robots.txt keeping crawlers off the pages of accounts (those pages leave search, and a crawler that comes another way still indexes); pages of accounts that link only what is indexed (a person opening another repository of the account would type its address); leaving it as it was (a deployment indexing and embedding what nobody asked for).
