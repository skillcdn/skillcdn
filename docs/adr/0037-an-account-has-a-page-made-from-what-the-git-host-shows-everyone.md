# ADR-0037: An account has a page, made from what the git host shows everyone

- Status: Accepted
- Date: 2026-10-04
- Extends the address scheme: `/gh/<owner>` was one segment short of an address and nothing else. Adds a kind of page to what [ADR-0011](0011-address-pages-rendered-on-the-server.md) renders on the server and lists.

## Context

A person who knows who made a skill wants to see what else that account has, and a person who signed in wants a page that is theirs to point at. The explorer deliberately has no catalog of everything indexed: asking for an address does not opt its author into one. An account's public repositories, though, are already listed by the git host for anyone who knows the name. Most of them hold no skills, and indexing every repository of every account somebody looks at would spend the host's quota on nothing.

## Decision

1. **`/gh/<owner>` is the page of an account**, for browsers, with `GET /api/v1/owners/gh/<owner>?page=` behind it. It is not an address: MCP at that path stays a `400`.
2. **It works for any account of the git host**, whether or not that account ever signed in here, and looks the same to everyone, signed in or not: who the account is, as the host says, and its public repositories as the host lists them, most recently pushed first, a page at a time.
3. **What is indexed and holds skills comes first.** The first page leads with cards for the account's repositories whose default branch this deployment has indexed and found skills in, most skills first, and leaves them out of the host's list below.
4. **Listing indexes nothing.** A repository is indexed when somebody opens it. The cards are read from the index as it is.
5. **Only what is public now.** A card is shown while the host still shows the repository to everyone: its public list names it, or the host confirms the name when asked. A repository that went private since it was indexed, or that cannot be confirmed, is not shown. A private repository is on nobody's page, not even its member's, and a blocked one does not exist.
6. **The page is one to find.** It is rendered on the server with its first page, like the page of an address, so that a crawler reads what a person sees. Once the account has something public to show, search engines may index it: one canonical URL per language, each naming the others. The sitemap lists the pages of the accounts whose repositories it lists.
7. **A crawler is not sent down the host's list.** The cards of indexed repositories are ordinary links. The links to the repositories the host merely lists say `nofollow`: opening a repository indexes it, and a crawler that followed every list would have every repository of every account it met read.

## Consequences

- An account's page costs the host a request or two for the profile and one per listed page, kept for as long as other facts about names are, plus one per indexed repository that the first listed page does not name. A crawler's visit costs what a person's does.
- Everything on the page is what the host shows anyone who asks for the account, so finding it through a search engine publishes nothing that was not public. An account does not choose to have a page here, as a repository does not choose to have an address.
- `nofollow` is a request, not a fence. A crawler that ignores it opens repositories as anyone may, and limiting how fast it does is for whatever stands in front of the server.
- The page says which of an account's public repositories were opened here, since those are the ones with cards. Nothing more about their use is shown.
- A repository shows up among the skills after somebody opened it once, and an owner makes that happen by opening it.
- What a signed-in person can reach that is not public lives in their account pages, which only they see.
- Rejected: indexing an account's repositories when its page is opened (most hold no skills, and anyone could spend the host's quota by naming accounts); a page only for accounts that signed in (the repositories are public whether or not their owner ever came here); showing members their private repositories on this page (one document for everyone is what makes it safe to keep, to link and to index); keeping the page from search engines (what it shows is public at the host already, and an account with skills here is what people look for); rendering it in the browser alone (a crawler that runs no scripts would read an empty frame).
