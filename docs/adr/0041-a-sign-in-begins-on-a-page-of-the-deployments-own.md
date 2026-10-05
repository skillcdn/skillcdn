# ADR-0041: A sign-in begins on a page of the deployment's own

- Status: Accepted; point 5, and the rejection of the account picker on every sign-in, are superseded by [ADR-0042](0042-every-sign-in-passes-the-git-hosts-account-picker.md)
- Date: 2026-10-05
- Builds on [ADR-0035](0035-people-sign-in-through-the-git-hosts-app.md). The contract is in [specs/permissions.md](../specs/permissions.md#signing-in).

## Context

Signing in went straight to the git host: the button in the header was a link to the route that redirects there. The first time, the host showed a page of its own and the person agreed on it. Every time after that the host had nothing left to ask and sent the browser back at once, so pressing "Sign in" signed a person in as an account they were never shown, and nothing on the way said what they agreed to. The same held for any link to that route, wherever it stood: following one from another site signed the visitor in here.

Signing in is also signing up. The first sign-in makes the account, so the moment before it is the only one at which a deployment that has terms and a privacy policy can put them before the person who accepts them.

## Decision

1. **There is a sign-in page**, at `/login`, and everything that offers signing in leads to it with the page to come back to: the header, a private repository that was not found, the account pages for someone who is signed out. It says what signing in is for and holds the way out to the git host.
2. **The way out is one component.** A button that names the host, and under it a sentence that says what continuing agrees to: the deployment's terms and its privacy policy, each only where the deployment has it. The consent page shows the same component in place of a link to the page, since a question already stands there. Nothing else links to the route that leaves for the host, and the button is not shown before the deployment's links are known.
3. **The route that leaves for the host begins a sign-in only for a browser that came from the deployment's own pages.** Browsers say where a navigation comes from (`Sec-Fetch-Site`). A request from anywhere else is sent to the sign-in page, with its way back kept. A request that says nothing is let through: it is from a browser too old to say, which could not sign in otherwise.
4. **A sign-in that did not complete comes back to the sign-in page**, with why, and with the page the attempt was for while the browser still carries it.
5. **A person can ask the host for another account.** The host signs in whoever its own session has. The component offers the host's account picker beside the button, and the consent page asks for it by itself for someone who has just said "not you".
6. **Someone signed in already is taken on** to the page they were to come back to, or to their account pages.

## Consequences

- One more page and one more press than the shortest way in, every time. The press is the point: it is the one thing on the way that a person does knowingly.
- The sentence is only as good as the deployment's links. A deployment without terms or a privacy policy says nothing about agreeing, and lets people in all the same.
- Following a link signs nobody in, in every browser that says where a request comes from. For the others, the state and the host-bound cookie still keep a sign-in to the browser that began it, as before.
- The page is one document for everyone, like the account pages: it offers nothing until the browser knows that nobody is signed in.
- A second git host is a second button on the same page.
- Rejected: a dialog over the page the person is on (nowhere for a sign-in that did not complete to come back to, and a second thing to build beside the pages that send people here); the notice in the footer alone (it is not where the person acts); making the route a form post (the pages allow forms to post to this origin only, and browsers differ on whether that covers the redirect to the host that follows); asking the host for its account picker every time (one more page at the host for everyone, for the few who want another account).
