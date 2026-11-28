# ADR-0130: The first screen is the promise alone, and the header leads to the start page

- Status: Accepted
- Date: 2026-11-28
- Supersedes point 1 of [ADR-0129](0129-the-front-page-leads-with-one-action-and-a-start-page-says-how-to-begin.md) (the way to start and the search on the first screen) and the first screen among the ways in of its point 5. The rest of ADR-0129 stands.

## Context

The first screen of ADR-0129 held the promise, one line of what the employee does, and two buttons under it: the way to the start page and the search across the packs. Seen on the page, the buttons stood between the line and the scene that shows it, and said nothing the page does not offer elsewhere: the header names the start page first on every page, and the search, the console's bar, the steps and the last call all stand further down.

## Decision

1. **The first screen is the promise and one line, with nothing to press.** The title and the line of what the employee does; the scene of the agent accounts follows right under them, and the AI apps are named under the scene, or under the line where a deployment shows no scene.
2. **The header is the way to start from the top.** Its first link is the start page, on the front page as on every other; the console's bar, the steps and the last call lead there as ADR-0129 has them.

## Consequences

- The scene comes higher onto the first screen. Analytics no longer count a click from the first screen (`hero_start`, `hero_search`); a visit that starts from the header is a view of the start page with the front page as the page before.
- **Rejected:** keeping the way to start alone on the first screen, which is still a button between the promise and the scene that shows it.
