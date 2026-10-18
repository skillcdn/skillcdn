# ADR-0060: A repository token may have no end

- Status: Accepted
- Date: 2026-10-18
- Amends [ADR-0040](0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md). The contract is in [specs/permissions.md](../specs/permissions.md#tokens-for-agents-with-nobody-to-sign-in) and [specs/rest.md](../specs/rest.md#people).

## Context

A repository token lasted from a day to a year, chosen when it was made ([ADR-0040](0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md)). The agents such tokens are for, a server, a scheduled job, a command on a machine that nobody sits at, are the ones nobody remembers to renew: a token that ends on a date ends in the middle of a night, and the agent stops reading until a person makes another and carries it over. The operator of the hosted service asked for the choice of no end.

## Decision

1. **A lifetime is optional.** `expiresInDays` of `POST /api/v1/me/tokens`, and of a connection's decision ([ADR-0059](0059-the-command-connects-with-a-code-a-person-approves.md)), takes `null` beside a count of days: the token then has no end. The pages offer it as one more choice after the lifetimes, never as the default, which stays ninety days.
2. **What ends such a token is what ended every token besides its date:** its maker removes it on their account page, or the git host stops vouching for them, which takes every token of theirs. The janitor leaves it alone. Nothing else changes: it still reads one repository as its maker, and every request still asks the git host whether that person may see it now.
3. **On the wire, no end is `null`.** `expires_at` of `repo_tokens` becomes nullable; `expiresAt` of a token in the person's list is `null` for such a token; the command says "with no end" where it said until when.

## Consequences

- A person who runs an agent that must not stop can make a token once; a person who wants the safety of a date keeps choosing one. The list on the account page says which is which.
- A token without an end is a standing credential: the page and the list say so plainly, and removing it is the one way to end it short of leaving the git host. An operator who wants to deny the choice, or cap lifetimes, needs a tunable that does not exist yet; it is added when an operator asks, as `TOKEN_DAYS_AT_MOST` or the like, and the pages then offer only what it allows.
- A breaking change of the REST shape for whoever read `expiresAt` as a string ([ADR-0058](0058-the-published-packages-share-one-version.md): a minor of the packages).
- Rejected: a very long lifetime instead of none (a date that is a lie, and a token that still ends while nobody is looking); no end as the default (the safer choice stays the easy one).
