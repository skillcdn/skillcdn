---
"@skillcdn/core": minor
---

Breaking: a repository token may be made without an end (ADR-0060). `expiresInDays` of `POST /api/v1/me/tokens`, and of the decision on a command that asks to connect, takes `null` for a token that lasts until its maker removes it, and `expiresAt` of a token in the person's list is `null` for such a token: a program that read `expiresAt` as a string reads `null` as well now. The lifetimes the pages offer and their default are unchanged.
