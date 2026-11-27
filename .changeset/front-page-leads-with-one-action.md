---
"@skillcdn/web": patch
"@skillcdn/core": patch
---

The front page leads with one action, and a new page, `/start`, says how to begin (ADR-0129). The first screen is the promise, one line of what an AI employee does, and the way to start, with the search across the packs as a link beside it and the scene of the AI employees right under it. The search box now stands in the packs section, which comes before the steps: `LANDING_SECTIONS` lists `packs` before `steps`. The start page shows the ways to start at a glance, from trying a skill to a team's console, then each with what to have ready, what to connect, the one sentence to tell an AI, to copy, and what the AI does then. The header links it first, and the console's bar, the steps and the last call of the front page lead there. An installation that builds the pages gets the page with them, and it shows the ways that need the console only where the installation's front page shows the console or the agents.
