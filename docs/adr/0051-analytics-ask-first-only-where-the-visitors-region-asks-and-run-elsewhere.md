# ADR-0051: Analytics ask first only where the visitor's region asks, and run elsewhere

- Status: Accepted
- Date: 2026-10-13

## Context

With analytics configured, every page asked every visitor, in a banner, before loading the script, and a browser that signaled Do Not Track or Global Privacy Control was never asked. That is the strictest reading of one region's law applied to the whole world: most visitors are nowhere near that region, most of them never answer a banner, and the operator saw a fraction of the funnel the pages were built to measure ([ADR-0050](0050-the-pages-tell-analytics-only-what-is-public-and-usage-is-counted-in-the-database.md)). The law that wants consent before an analytics cookie is set is that of the European Economic Area, the United Kingdom and Switzerland; most other jurisdictions ask for a notice and a way to say no.

The analytics service's consent mode takes defaults per region, which it applies by where it sees the visitor itself. It cannot tell the page which region that is, so whether to ask is the page's own decision, and for it the page has to know where the visitor is. A deployment usually has a proxy or a CDN in front that knows and says so in a header; one that has not can place nobody.

## Decision

1. **The pages ask first only where the visitor's region asks.** The regions are configuration (`ANALYTICS_CONSENT_REGIONS`), by default the European Economic Area, the United Kingdom and Switzerland; `*` asks everywhere and `none` nowhere. The server writes into each page, per request and before the analytics bootstrap, whether this visitor is asked.
2. **Where the visitor is, a trusted proxy says.** The header is named in configuration (`CLIENT_COUNTRY_HEADER`) and read only from a trusted proxy, as the client address is. A visitor who cannot be placed, because no header is configured, the proxy sent none, or it said it could not place them, is asked: asking is the safe answer, and a deployment with nothing in front keeps what it had.
3. **Elsewhere analytics run at once, and the footer offers the choice.** No banner and no popup: the footer's "Analytics choices" opens the same card, which says whether analytics run and turns them off, or on again. The answer is kept in the browser for the next visit, as the answer to the banner is.
4. **Global Privacy Control is a no; Do Not Track is not read.** A browser that signals Global Privacy Control is never asked, never loads the script, and has no choice to make. Do Not Track is not read any more: browsers have retired it in favor of Global Privacy Control.
5. **The script's consent mode carries the same regions as its defaults:** analytics storage denied there and granted elsewhere, advertising denied everywhere. A visitor the service places in a region that asks has analytics storage denied whatever the page was told; a visitor who agreed in the banner has it granted by their answer. Where the page asks, nothing is loaded before the answer (the basic form of consent mode), so a visitor there sends nothing until they agree.

## Consequences

- The deploy documentation says how to name the header and the regions, and what the privacy policy has to say where the pages do not ask: that analytics run, and where to turn them off.
- A visitor from a region that asks sees what they saw before; everyone else sees no banner. The development server shows both, for a country named in the URL.
- Advertising consent remains a decision of its own (ADR-0050): the defaults deny it everywhere, and the card asks for analytics only.
- Rejected: loading the script everywhere before any answer and relying on the service's cookieless pings in the regions that ask (data leaves the page before the visitor said yes, which the pages promise not to do); placing the visitor by the browser's time zone or language (wrong often enough to ask the wrong people and not the right ones); a notice banner outside the regions that ask (the law there wants a way to say no, not a banner, and the footer is that way).
