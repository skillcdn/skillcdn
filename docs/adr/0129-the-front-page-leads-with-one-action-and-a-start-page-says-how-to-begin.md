# ADR-0129: The front page leads with one action, and a start page says how to begin

- Status: Accepted; point 1 and the first screen among the ways in of point 5 are superseded by [ADR-0130](0130-the-first-screen-is-the-promise-alone-and-the-header-leads-to-the-start-page.md) (the first screen has nothing to press)
- Date: 2026-11-27
- Builds on [ADR-0075](0075-a-search-across-the-packs-has-a-page-per-term-that-search-engines-may-list.md) (the sections of the front page, whose first screen and order this changes), [ADR-0128](0128-the-front-page-shows-the-agent-accounts-as-a-scene-the-browser-plays.md) (the scene of the agent accounts) and [ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md) (the reference console and its pack).

## Context

The first screen promised an AI employee and offered a search box for skills: two stories on one screen, with the scene that shows the employee under it. The way from that promise to an agent account at work was nowhere on the pages. The button under the scene, both buttons of the console's bar and one of the three steps led to the page of the console pack, which is the page every pack has; the three steps named an order that could not be walked, the second needing the third; and what a step takes, a coding agent, a container runtime, an account for the agent to sign in with, a subscription of its own, was learned on the way. How each thing is done is written already, in the packs, for the agent that does it.

## Decision

1. **The first screen is one promise and one action.** The title, one line of what the employee does, and the way to start, with the search across the packs as the quieter link beside it, the explorer where a deployment has no search. The scene of the agent accounts stands right under it, and the AI apps are named under the scene, or under the action where a deployment shows no scene.
2. **The search box stands with the packs.** The `packs` section holds the box and its terms, over the address field and beside the cloud of packs, and comes before the steps: `agents`, `organizations`, `showcase`, `console`, `packs`, `steps`, `builders`, `faq`, `cta`. The header keeps its link to the search on every page.
3. **A start page, `/start`, says how to begin.** A page of the build, prerendered per language and one for search engines, with the ways to start in an order that can be walked: try a skill, work a board with one's own AI, hire an AI employee, grow into a team's console. They stand at a glance at the top, each a link to its own step. Each says what comes of it and what to have ready, gives what to connect and the one sentence to tell an AI, to copy, and says in a line what the AI does once told.
4. **The page is a map, not a manual.** It explains nothing of how a step is done: that is the pack's to say to the agent that does it, and a second copy on a page goes stale with the pack's next release. A sentence on it is one the pack answers as that pack stands, and the line of what comes then is what the pack's skill does.
5. **Every way in leads there.** The first screen, the console's bar, the steps and the last call lead to the start page, at a step's own heading where one step is meant (`/start#board`); the steps of the front page are the same ways, a line each, and the header names the page first.
6. **A deployment's choice holds on it.** The ways that need the console are shown where the deployment's front page shows the console or the agents, the way in through the builders where it shows them, and the box where the deployment searches.

## Consequences

- A newcomer who presses the one button sees what each step takes before anything is installed. The page of a pack is where a pack is connected, and no longer the answer to how to start.
- The front page of a deployment that lists `packs` alone is still the first screen and the packs, the box now in the section and not above it. `LANDING_SECTIONS` names the same sections, in the page's new order.
- The start page names what the reference console's skills ask for and do. When that pack changes what a step takes, what its skill does or how it is asked for, the words of the page change with it: it is the one place on the pages that follows another repository, and its sentences are tried against the pack when they change.
- Analytics gain the page (`start`), what was copied on it by step (`start_copy`), and the ids of the links that lead there.
- **Rejected:** a guide written out on the pages or in the documentation, which repeats the skills and is read by the person where the agent does the work; the search box kept on the first screen beside the action, which is the two stories again; and a page of a pack as where a step leads, which is where the way stopped.
