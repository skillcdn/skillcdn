# ADR-0029: The terms and the privacy policy can be written into the deployment

- Status: Accepted
- Date: 2026-09-26
- Extends the legal surface of [ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md) (point 4) and the operator content of [ADR-0028](0028-the-front-page-and-the-explorer-are-operator-content.md).

## Context

A public deployment must show its visitors its terms of service and its privacy policy. So far they were links: `TERMS_URL` and `PRIVACY_URL` name pages hosted somewhere else, and every page carries them as standard link types and in the footer. An operator who has nowhere else to host such pages, or who wants their URLs to stay on the deployment's own origin for as long as it runs, had to build and host them apart from the product, and a link that changes later invalidates what was printed and agreed to.

## Decision

1. **The two pages can be written into the deployment.** The operator writes each through the admin API (`/admin/v1/legal/terms`, `/admin/v1/legal/privacy`) as a title and a Markdown body per language, with the date the text was last revised. The pages are served at `/terms` and `/privacy` on the deployment's own origin, rendered by the server with the document as the page of an address is, in the visitor's language when it was written in it and in the default language otherwise; a page that has not been written is not there.
2. **A written page comes before a configured URL.** Every page links, in its head and its footer, to the written page when there is one and to `TERMS_URL` or `PRIVACY_URL` otherwise; the consent banner follows the same link. The configured URLs stay for pages hosted elsewhere.
3. **Markdown is rendered as the pages render repository content:** as elements, never as HTML, with links limited to a few schemes and no images loaded.

## Consequences

- An operator sets up a public deployment without hosting anything else: write the two pages, set the contact. The pages are found (sitemap, canonical URLs per language) and their URLs never leave the deployment.
- The links in the head are decided per request from what exists right now, so a page written or removed shows in every page within the cache life of the documents, without a restart.
- The renderer is the one repository content goes through, so an operator's page can carry nothing a repository could not; the operator is trusted for the words, not for markup.
- Rejected: files mounted into the image (a volume per replica and a restart per change, and one language per file); a `TERMS_TEXT` variable (a policy does not fit an environment variable, and its languages do not either).
