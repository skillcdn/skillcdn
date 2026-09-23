---
name: incident-review
description: Guides a blameless incident review, from building the timeline to agreeing on follow-up actions. Use after an outage or a near miss.
allowed-tools: Read
---
# Incident review

Start from the timeline template in `assets/timeline.json` and fill it in with the people who were there.

- Ask what made sense at the time; do not ask who was at fault.
- Separate contributing factors from the trigger.
- End with owners and dates for every follow-up action.

`scripts/collect.sh` shows how the raw notes were gathered. It is reference material: read it, do not run it.
