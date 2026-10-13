# ADR-0050: The pages tell analytics only what is public, and usage is counted in the database

- Status: Accepted
- Date: 2026-10-13

## Context

A deployment may load a web analytics script once the visitor agrees (milestone 4). What the script then sends is its default: the URL and the title of every page, which on these pages name a private repository to whoever is signed in, carry the sealed request of the consent page, and repeat whatever a visitor typed into the address bar; and nothing of what the operator wants to know, which is whether a visitor got as far as connecting an agent. Meanwhile what agents do is counted in the database ([ADR-0010](0010-distinct-clients-by-daily-keyed-hash.md), [ADR-0027](0027-client-hashes-are-keyed-from-a-configured-secret-and-the-day.md)), per public repository only, and nobody could read the counts without opening the database.

The question was whether the agents' side should go to the analytics service too. It should not. The service is built around a browser, a cookie and a consent banner, none of which an agent has. Sending from the server needs a client identifier, and a stable one would be the tracking identifier the counting was designed not to keep. And a third party would become the processor of every request an agent makes, which a self-hosted installation cannot accept.

## Decision

1. **Usage is counted in the database and read through the admin API.** Per public repository: connections, tool calls per tool, loads per skill, reads per file, and distinct clients. For the deployment as a whole: the same over every repository, public or not, naming none, and distinct clients by the app they named. The admin API answers the totals, the rankings and one repository; a worker reads the same for rankings and recommendations. No usage event of an agent is sent to an analytics service.
2. **The pages send their own page views and events, and never more than what is public.** The analytics configuration sends no page view of its own. A page is sent as what it is: an address once the server has answered that the repository is public, with the skill when the view is one and it loaded; a stand-in path (`/gh/-/-`, `/gh/-`) for a repository or an account that is not public or is nothing, which read the same; the consent page without its query; a bad address or a missing page by its name alone. The title sent is the kind of page. A search, a typed path, a referrer of this origin, a sealed request: never.
3. **Events are the steps of one funnel**, named and parametrized from short lists written in the web UI's README, so that a conversion is one key event in the property: an address submitted, a call to action, a client chosen in the connection guide, a connection started (the install link, the open link, or a copy of the address, the configuration or the command), the first message copied, a sign-in opened, started and completed, an app allowed to read an address, a token made for an agent. Nothing a visitor typed is a parameter.
4. **Consent stays analytics-only.** The banner asks for analytics storage and nothing else. Advertising consent, were a deployment to want it, is a decision of its own, with its own words in the banner.

## Consequences

- An operator turns off the automatic measurement of page changes in the property, since the pages count them, and marks the key events; the deploy documentation says so.
- Adding a page or an event is adding to `src/analytics.ts` and to the README's lists, and nothing else; the module's test keeps the stand-ins.
- The analytics service undercounts: blocked by ad blockers, refused in the banner. The database holds the numbers to rely on; the service measures the funnel of the pages.
- Rejected: sending agent usage through the service's server-side protocol (a client identifier per agent, a third party for every request, nothing a self-hoster can keep in); leaving page views to the script (private names, sealed requests and typed text leave the page); counting private usage per repository (names the repository).
