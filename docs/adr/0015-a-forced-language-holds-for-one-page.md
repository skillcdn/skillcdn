# ADR-0015: A forced language holds for one page; links inside the app carry no language

- Status: Accepted; amends point 2 of ADR-0013; point 1 (a forced language holds for one page) is amended by ADR-0017
- Date: 2026-09-22

## Context

ADR-0013 kept the URL clean for a visitor reading their own language, and let a URL that names a language (`?lang=ko`) force it and carry it on: every link inside the app kept the parameter, so a forced page stayed forced wherever it led. In use, that is where the parameter came back from. A visitor arrives at a forcing URL (from a search result, from the switcher before scripts have loaded, from a link someone shared), and from then on every page they open, and every link they copy, carries `?lang=ko` again. The forcing URL had become sticky after all.

## Decision

1. **A language the URL forces holds for that page only.** The page is shown in that language, whatever the visitor prefers, and its URL stays as it is.
2. **Links inside the app never carry the language.** Every link is the clean URL of its target, so the next page is shown in the reader's own language (their choice, else their browser's, as ADR-0013 says), and a link copied from any page opens in each reader's language.
3. **Forcing URLs remain for what needs them**: the switcher's links, the `hreflang` alternates and the sitemap, and a link a person writes when they mean a language. They are followed, never propagated.

## Consequences

- The prerendered Korean pages link to clean URLs. Crawlers find the Korean pages through `hreflang` and the sitemap, as they already did, not by following links from one Korean page to the next.
- A visitor whose browser prefers another language and who opened a forcing URL is back in their own language on the next page. To stay in a language, they choose it in the switcher, which sets their preference (ADR-0013, point 3).
- ADR-0013 rejected stripping the parameter from links alone because the address bar would still carry it. That is now the decision: the address bar of the forced page keeps it, which is the truth about that page, and no link repeats it.
