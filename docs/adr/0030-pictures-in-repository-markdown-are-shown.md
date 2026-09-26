# ADR-0030: Pictures in repository Markdown are shown

- Status: Accepted
- Date: 2026-09-26
- Amends point 3 of [ADR-0029](0029-terms-and-privacy-pages-can-be-written-into-the-deployment.md) (pages of the deployment's own render the same way).

## Context

The explorer rendered repository Markdown without its pictures: an image stood as its alternative text, because loading a picture tells its host who is reading. Skills and READMEs come with diagrams, screenshots and example frames, and a page that shows their text without them reads as broken to the person who opened it. The page of an address is meant to show what an agent gets, and a picture is part of that.

## Decision

1. **A picture in repository Markdown is shown.** One with an `https` URL is loaded from that URL as written. One that is a path of the repository is loaded from the git host's raw copy of the file at the commit the page shows, resolved against the file it is in and never outside the repository root. Anything else (another scheme, a path that leaves the repository, a `data` URL) stands as its text.
2. **It is loaded lazily and without a referrer.** The browser fetches a picture only once the reader scrolls to it, and sends no referrer, so the picture's host learns neither the page nor the address it was read on. The content security policy of the pages allows images from any `https` origin and nothing else from elsewhere.
3. **Nothing is proxied.** SkillCDN indexes and serves text; it does not fetch, cache or re-serve pictures. A path of the repository is a link to the host, as "View on GitHub" is.
4. **Pages of the deployment's own render the same way**, so an `https` picture in the terms or the privacy policy is shown; a relative path has no repository behind it and stands as its text.

## Consequences

- A reader who scrolls to a picture tells its host their IP address and user agent, as they do when they read the same file at the host. The referrer is withheld, so the host does not learn which page they were on.
- A picture the host serves without an image type (an SVG from a raw file, for example) does not render; that is the host's decision, not the page's.
- The rule that repository content never becomes an `<img>` is gone; the rule that it never becomes HTML, a script, a frame or a link to another scheme stays.
- Rejected: proxying pictures through the deployment (SkillCDN would then host content, against its first principle, and take on abuse and cost); a click-to-load placeholder (the page is meant to show the skill as it is, and a reader who opened it asked for it).
