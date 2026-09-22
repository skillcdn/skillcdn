# @skillcdn/web

The web UI: a landing page and an explorer that shows what an agent gets from an address. English and Korean. Vite, React and plain CSS; the build is static files, prerendered once per language ([ADR-0009](../../docs/adr/0009-web-ui-prerendered-per-language.md)), plus a module the server uses to render the page of an address with its data ([ADR-0011](../../docs/adr/0011-address-pages-rendered-on-the-server.md)).

It is optional. A deployment without it is still a complete MCP and REST server, and the UI uses nothing but the public [REST API](../../docs/specs/rest.md).

## Run it

You need git and [pnpm](https://pnpm.io/installation) (`winget install pnpm.pnpm` on Windows, `brew install pnpm` on macOS). pnpm fetches the right Node.js by itself. No container runtime, no database, no server and no token are involved.

```sh
git clone https://github.com/skillcdn/skillcdn.git
cd skillcdn
pnpm install
pnpm dev:web          # http://localhost:5173
```

The development server answers the REST API from fixtures (`dev/fixtures.ts`), so every page works and every state can be reached:

- **<http://localhost:5173/dev/states>** lists every state of every page (loading, indexing, empty, errors, long texts, a partial index) and shows every building block on one page.
- Add `?lang=ko` to any URL to force Korean. Without it the page is shown in the language you picked last, else your browser's, and the URL stays as it is.

To look at real repositories instead, the UI can run in front of a real server, which answers the REST API and MCP while the pages stay local: `pnpm dev:web:live` uses the hosted service at `https://skillcdn.ai`, and `pnpm dev:web:api` a server on this machine (see [`apps/server`](../server/README.md), `http://127.0.0.1:11188`). Either takes another server from `SKILLCDN_API_URL` in `apps/web/.env.local`. Fixtures remain the way to see every state, since a real server only shows the states its repositories are in.

## Where the design lives

| To change... | Edit |
|---|---|
| Colors, fonts, sizes, spacing, radii | [`src/styles/tokens.css`](src/styles/tokens.css). Every value the UI uses is a token; components contain no raw colors or font stacks. The UI is dark only: one value per color. |
| The Korean font | Hangul is drawn by Pretendard, self-hosted from the `pretendard` package. Latin stays with the system fonts in the stack. [`src/styles/pretendard.css`](src/styles/pretendard.css) is generated: run `pnpm --filter @skillcdn/web run generate:fonts` after changing the package version. Its license ships with it as [`public/licenses/pretendard.txt`](public/licenses/pretendard.txt), listed in [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md). |
| Document defaults (headings, links, focus ring) | [`src/styles/base.css`](src/styles/base.css) |
| A building block (button, badge, callout, tabs, code block, address form) | `src/components/<name>.tsx` with its styles next to it in `<name>.module.css` |
| The clips beside "how it works" | `HOW_CLIPS` in [`src/site.ts`](src/site.ts), one per step, in the order of the steps. The files go under `public/`. A step without a clip shows an empty frame. |
| A page | `src/pages/`: `landing`, `explore`, `mount*` (the page of an address: its name and description, how to connect an agent, then what it serves), `simple` (not found, bad address) |
| The steps to connect each client | [`src/components/connect-guide.tsx`](src/components/connect-guide.tsx) builds the commands, the links and the configuration from the address; the words live under `connect` in the language packs. A new client is a tab there and its steps in every pack. |
| How rendered Markdown from repositories looks | [`src/components/markdown.module.css`](src/components/markdown.module.css) |
| Words | [`src/i18n/messages/en.ts`](src/i18n/messages/en.ts) and [`ko.ts`](src/i18n/messages/ko.ts). English is the source; the Korean pack must have the same shape, and a test checks it. |
| The symbol and the favicon | [`public/brand/symbol.svg`](public/brand/symbol.svg), [`public/favicon.svg`](public/favicon.svg), and the inline copy in `src/components/layout.tsx`. They are placeholders until there is a logo. |
| Social-preview images | `public/og/og-<language>.png`, 1200 x 630. Replace the files, or restyle `src/pages/og-card.tsx` and take new screenshots of `/dev/og` and `/dev/og?lang=ko` in a 1200 x 630 window. |

Styles are CSS modules: a class is local to its component, so renaming or restyling one cannot break another. Breakpoints are `40rem`, `52rem` and `60rem`.

## How it is built

`pnpm --filter @skillcdn/web run build` does three things: the client bundle, a self-contained bundle of `src/entry-server.tsx` that renders pages to HTML (`dist/render/entry-server.js`), and `scripts/prerender.mjs`, which writes into `dist/`:

- every static page once per language (`index.html`, `index.ko.html`, `explore/index.html`, ...), with its title, description, canonical and `hreflang` links, social-preview tags and structured data already in the HTML, because most crawlers do not run scripts;
- a shell for pages that depend on data, for a host that cannot render them;
- `template.html`, the document that pages are rendered into, kept for the server;
- `llms.txt` per language;
- `routes.json`, which tells whatever serves `dist/` which file answers which URL in which language, and names the render module.

The explorer view of an address is rendered by the server per request: it calls `renderAddressPage` from the render module with the language, the origin, the URL and the answers the page would ask the REST API for, and the page carries those answers in a JSON element (`#skillcdn-data`) so that the browser hydrates instead of loading them again (`src/api/initial-data.ts`, `src/api/use-resource.ts`). The head of that page (`src/seo/head.ts`) says whether it may be indexed: the overview of an address without a ref and one skill are; a ref, a file, a search or an index that is not ready are not.

Languages share their paths; `?lang=ko` forces Korean, and a URL without a parameter is English to the server and to crawlers. In a browser such a URL is shown in the visitor's language instead, without the URL changing: `public/boot.js` hides the prerendered page when another language is wanted, and the app renders it in that language ([ADR-0013](../../docs/adr/0013-language-decided-in-the-browser-without-changing-the-url.md)). Pages carry a placeholder instead of the public origin, which the server fills in, so one build works on any domain. For a plain static host, build with `SKILLCDN_PUBLIC_URL=https://your.host` and the origin is written into the files; such a host serves the default language only.

## Adding a language

A pack in `src/i18n/messages/`, an entry in `src/i18n/languages.ts` and in `src/i18n/index.ts`, the code in the list in `public/boot.js`, and `public/og/og-<language>.png`. Tests fail until they all agree.

## Constraints

- **REST only.** The UI may import types, schemas and the address parser from `@skillcdn/core`, and nothing else from the workspace. The render module is the one thing the server calls, and it takes plain data.
- **Repository content is untrusted.** Markdown is rendered as React elements, never as HTML. Raw HTML stays text, links go to `http(s)`, `mailto` or another file of the same mount, and images are never loaded, because loading one tells a third party who is reading.
- **No inline scripts or styles**, so the pages work under a strict content security policy. The one exception is not in this workspace: the server may add an operator's tags to the head of every page (search-console verification, analytics; see `deploy/README.md`), and widens the policy for exactly those.
- **No secrets in the client.** Everything in a browser bundle is public.
- **No business model in the UI**: no plans, prices or checkout (root `CLAUDE.md`, rule 6).
