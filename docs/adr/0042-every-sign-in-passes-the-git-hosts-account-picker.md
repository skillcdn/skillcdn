# ADR-0042: Every sign-in passes the git host's account picker

- Status: Accepted
- Date: 2026-10-05
- Supersedes point 5 of [ADR-0041](0041-a-sign-in-begins-on-a-page-of-the-deployments-own.md), and its rejection of asking for the picker every time. The contract is in [specs/permissions.md](../specs/permissions.md#signing-in).

## Context

A git host signs in whoever its own session has. It shows a page of its own the first time, when the person has to approve the app, and to someone signed in to several accounts at once; everyone else is sent straight back. So a returning person pressed the button on the sign-in page and was signed in as an account nobody had shown them: they read which one afterwards, in the header. On a browser somebody else left signed in to the host, that is too late to notice.

The sign-in page cannot say it beforehand. Which account a browser is signed in to at the host is the host's to know, and it tells no other site. What a host offers instead is a page of its own that shows the account and the way to another one, when it is asked for. ADR-0041 offered that page beside the button, to whoever wanted another account, and left everyone else to the host's default.

## Decision

1. **Every sign-in asks the host for its account picker.** The person sees, at the host, which account they continue with, and can pick another there, before the browser comes back signed in. At GitHub that is `prompt=select_account` on the authorization request.
2. **It is the adapter's to ask**, in whatever way its host has. The login port has no option for it, and neither has the login route: there is no sign-in that skips the picker.
3. **The sign-in page offers no way to choose an account.** The link beside the button, its parameter and the consent page's special case for "not you" are gone: the picker is where another account is chosen, and it is always there.

## Consequences

- One more page at the host on every sign-in, and two on the first, the picker and then the host's own approval. Signing in is rare, since a session lasts for as long as it is used, and the certainty is worth a page each time.
- Nobody comes back signed in as an account they were not shown, whoever used the browser before them.
- Nothing about a person is kept in their browser for this. What the deployment shows is what the host knows now, not what the deployment remembers.
- A host with no such page signs people in as it always did, and its adapter says so.
- Rejected: remembering in the browser who signed in last and offering to continue as them (it leaves a name behind on a shared computer, shows the deployment's memory rather than the host's session, and knows nothing on a browser the person has not used before); the picker only on request, as ADR-0041 had it (the default stays a sign-in nobody was shown).
