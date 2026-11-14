# ADR-0099: The pages take pages of an installation's own from a configuration of the build

- Status: Accepted
- Date: 2026-11-14
- Builds on [ADR-0009](0009-web-ui-prerendered-per-language.md) (the build tells the server which file answers which address, and the server knows nothing of the UI), [ADR-0011](0011-address-pages-rendered-on-the-server.md) (the render module of a build runs in the server) and [ADR-0028](0028-the-front-page-and-the-explorer-are-operator-content.md) (what a deployment shows is the operator's).

## Context

Every installation needs screens around its packs that are nobody else's: what its operator looks at to see whether a pack is indexed and how far its embedding is, the way its people have a pack made from their originals. They are not the product's to ship, and the admin API and the REST API already answer everything such a screen asks. What was missing is a place to put one. The pages were a closed set: the routes, the menu of the header and the list of what is prerendered each named the product's pages and no other, so one more page meant a fork of the web workspace, kept in step with every release.

The server is already open. It serves whatever build `WEB_ROOT` points at, answers the addresses `routes.json` lists with the files it names, and holds no list of pages of its own.

The reference console, a separate repository, solved the same need without plugins: its pages are a composition that takes a configuration, and an installation's pages are entries of it, each with a key, a word, and a function that is given what the default pages are given. The pages here differ from the console's in one way that matters. They are prerendered per language, and the render module of a build is loaded into the server, where it renders the page of an address per request.

## Decision

1. **A build takes a configuration, and the configuration names pages.** `SKILLCDN_WEB_CONFIG` names a file that exports `site`, made with `defineSite({ pages })`; without it the build is the product's own, with no such pages. A page has a `key`, a `label` (one word, or a word by language), whether the header's `menu` names it, whether it is `wide`, and `render(context)`.
2. **A page lives at `/pages/<key>`**, the same in every language. The key is lowercase letters, digits and hyphens; a build with a key that is not one, or with a key twice, fails.
3. **A page is given what the product's pages are given**: the REST client of the deployment it is served from, the language and the product's words in it, the public origin, the query of its address, and the way to move to another page without loading a document. It is written with React, as the pages are, and styled from their tokens.
4. **A page is drawn in the browser, and nowhere else.** The build lists its address in `routes.json` with the files of the frame and `indexable: false`; the server answers the frame, and the page draws itself once the frame is up. Where the server renders a page of the build per request, it renders the same frame: `render` is never called outside a browser. A page is never in the sitemap, says `noindex`, and tells analytics nothing.
5. **The server does not change.** It reads `routes.json` as before. The content security policy of a page is the pages': scripts and styles from the deployment's own origin, and connections to it alone.
6. **The file may stand anywhere**, with its components and style sheets beside it. What it imports of the packages the pages are built with is resolved from the web workspace, and `@skillcdn/web` is the module that says what a configuration is, so that a directory of an installation holds its pages and nothing else.

## Consequences

- An installation adds a screen without a fork: a checkout of this repository at the release it runs, a file of its own outside it, one build, and the output where `WEB_ROOT` points. The example in the web workspace (`examples/site`) is such a file, and the tests render the pages with it.
- A page reaches the REST API and, with a token its operator types into it, the admin API. It reaches nothing else: a service an installation runs beside the deployment is reached where the installation's reverse proxy puts it under the deployment's own origin. The policy is not widened by a build.
- The code of a configuration is in the render module, which the server loads: what it does when it is loaded, it does in the server. `WEB_ROOT` was always to point at a build one made or trusts, and that now includes the configuration it was made with.
- A page that should be found by a search engine, or rendered with data, is not one of these. That is a page of the product, added to it as before.
- The product's own build is what it was: no page, no entry in the menu, the same `routes.json`.
- Not decided here, and the next step: the web workspace as a published package with a build command of its own, so that an installation depends on a version instead of a checkout. It needs what a build takes from the repository today to travel with the package (the documentation's files, the font, the notices of what is bundled), a first publication by a maintainer, and a decision on the marks a changed build shows under the trademark policy. Replacing pieces of the pages (the header, a section of the front page) and bringing a language are part of that step, and are not built: an installation that needs them still changes the workspace.
- Rejected: plugins that are switched on in a running deployment (a host for them, their capabilities and their isolation are a product of their own, and a build already is the unit an operator deploys). Rejected: operator screens in the product (each installation's are different, and the API they read is the contract). Rejected: rendering an installation's page on the server (its code would run per request in the process that holds the deployment's secrets, for a page no search engine is to read).
