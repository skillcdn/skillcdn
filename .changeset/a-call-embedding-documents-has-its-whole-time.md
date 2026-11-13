---
"@skillcdn/inference": patch
---

A call that embeds documents has its whole timeout once its turn comes. The time it waited for a slot used to come out of it, so a short call that waited behind a long one failed as unanswered within what was left, for the other call's length and not its own. It still waits no longer than the timeout for its turn, and fails as busy when the turn does not come. A query is as before: the wait counts, since a search waits for it.
