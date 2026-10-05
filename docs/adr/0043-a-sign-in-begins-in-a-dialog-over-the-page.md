# ADR-0043: A sign-in begins in a dialog over the page

- Status: Accepted
- Date: 2026-10-05
- Supersedes points 1, 4 and 6 of [ADR-0041](0041-a-sign-in-begins-on-a-page-of-the-deployments-own.md), and its rejection of a dialog. Points 2 and 3 stand, and so does [ADR-0042](0042-every-sign-in-passes-the-git-hosts-account-picker.md). The contract is in [specs/permissions.md](../specs/permissions.md#signing-in).

## Context

ADR-0041 gave signing in a page of its own, at `/login`. What that page holds is one button, and what follows the button happens at the git host: its account picker, and the first time its approval. A page in between took a person away from what they were looking at for a single press, and brought them back to it afterwards. It also had to explain itself, since a page with one button on it reads as unfinished.

ADR-0041 rejected a dialog because a sign-in that did not complete would have nowhere to come back to. It has: the page the attempt was for.

## Decision

1. **Signing in is offered in a dialog over the page a person is on**, and that page is where they come back to. The header, a private repository that was not found and the account pages of someone signed out open it. There is no sign-in page and no path for one.
2. **The dialog holds the way out of ADR-0041, unchanged**: the one button that names the git host, and under it what continuing agrees to. Around it there is a welcome, not an explanation. The consent page keeps the same component in place, since a question already stands there.
3. **The server asks a page to open the dialog** with a parameter, `sign_in`, that every page takes. A request to the route that leaves for the host which did not come from the deployment's own pages is sent to the page it named, or the front page, with `sign_in=open`. A sign-in that did not complete is sent to the page it was for with why: `sign_in=denied`, `expired` or `failed`. The page reads the parameter once and takes it out of its URL, so that a reload or a copied link is the page and not the question again.
4. **The dialog exists only for someone the browser knows is signed out.** The server renders none, and someone signed in is asked nothing: they are on the page already.
5. **The account pages say what they are to someone signed out**, under the dialog that opens over them by itself, so that closing it leaves a page with a way back in rather than an empty one.

## Consequences

- One press fewer between wanting to sign in and the git host, and no page whose only content is that press.
- Every page can now be opened with the dialog on it, by anyone who writes the parameter into a link. It opens what the header's button opens, and nothing is begun by it: the rule of ADR-0041 that only a press on the deployment's own pages leaves for the host is what keeps a link from signing anyone in, and it is unchanged.
- The dialog is in what every visitor downloads, where the page was loaded by the few who went there. It is one small component.
- A link to `/login` from the hours that page existed finds nothing.
- Rejected: keeping `/login` as a second way to the same thing (two things to keep alike, for a path nobody needs); a dialog that the server renders open (the document is one for everyone, and the server does not know who is signed in); keeping the parameter in the URL while the dialog is open (a copied link would open it for whoever follows it, with someone else's failure in it).
