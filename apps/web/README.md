# @skillcdn/web

The web UI: a landing page and an explorer that shows what an agent gets from an address. English and Korean. Vite, React and plain CSS; the build is static files, prerendered once per language ([ADR-0009](../../docs/adr/0009-web-ui-prerendered-per-language.md)), plus a module the server uses to render the page of an address with its data ([ADR-0011](../../docs/adr/0011-address-pages-rendered-on-the-server.md)).

It is optional. A deployment without it is still a complete MCP and REST server, and the UI uses nothing but the public [REST API](../../docs/specs/rest.md).

## Run it

You need git and [pnpm](https://pnpm.io/installation) (`winget install pnpm.pnpm` on Windows, `brew install pnpm` on macOS). pnpm fetches the right Node.js by itself. No container runtime, no database, no server and no token are involved.

```sh
git clone https://github.com/skillcdn/skillcdn.git
cd skillcdn
pnpm install
pnpm dev:web          # http://localhost:11189
```

The development server answers the REST API from fixtures (`dev/fixtures.ts`), so every page works and every state can be reached:

- **<http://localhost:11189/dev/states>** lists every state of every page (loading, indexing, empty, errors, long texts, a partial index) and shows every building block on one page.
- Add `?lang=ko` to any URL to force Korean; that is then your preference, like a click in the language switcher, until you pick another. Without a parameter the page is shown in that preference, else your browser's language, and the URL stays as it is. Links inside the app never carry the parameter.

To look at real repositories instead, the UI can run in front of a real server, which answers the REST API and MCP while the pages stay local: `pnpm dev:web:live` uses the hosted service at `https://skillcdn.ai`, and `pnpm dev:web:api` a server on this machine (see [`apps/server`](../server/README.md), `http://127.0.0.1:11188`). Either takes another server from `SKILLCDN_API_URL` in `apps/web/.env.local`. Fixtures remain the way to see every state, since a real server only shows the states its repositories are in.

The integrated server's default port is **11188**. To serve the built UI there as well, build the web workspace and point `WEB_ROOT` at `apps/web/dist` when starting the server. The separate Vite development UI uses **11189**, the next port up, and may choose a higher available one when that is occupied; it does not change the API port.

## Where the design lives

| To change... | Edit |
|---|---|
| Colors, fonts, sizes, spacing, radii | [`src/styles/tokens.css`](src/styles/tokens.css). Every value the UI uses is a token; components contain no raw colors or font stacks. The UI is dark only: one value per color. |
| The Korean font | Hangul is drawn by Pretendard, self-hosted from the `pretendard` package. Latin stays with the system fonts in the stack. [`src/styles/pretendard.css`](src/styles/pretendard.css) is generated: run `pnpm --filter @skillcdn/web run generate:fonts` after changing the package version. Its license ships with it as [`public/licenses/pretendard.txt`](public/licenses/pretendard.txt), listed in [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md). |
| Document defaults (headings, links, focus ring) | [`src/styles/base.css`](src/styles/base.css) |
| A building block (button, badge, callout, tabs, code block, address form) | `src/components/<name>.tsx` with its styles next to it in `<name>.module.css` |
| The featured creation | `FEATURED_VIDEO` in [`src/site.ts`](src/site.ts) and [`featured-skill.tsx`](src/components/featured-skill.tsx), shared by landing and explore. The initial editorial pick is `skillcdn/examples`; operator-configured recommendations remain available below it. The clip in `public/showcase/` is an original AI-generated concept film of the kind of result the skill is for, not a recording of a completed skill run; replace it with an actual result when available. It is one muted, looped MP4 (H.264, small enough to be a hero image) that loads only once it is on screen, and its poster is its first frame, so that playback starts where the picture was. A browser may refuse to start it even muted (Samsung Internet has a setting for that, and phones saving power do too): then the same clip as an animated AVIF (`public/showcase/*.avif`, a fraction of an animated WebP's size at the full frame rate) takes its place, and a browser without AVIF shows the poster. Under reduced motion it does not start, and the poster stands. The poster is also the picture on the social-preview card. Replacing the clip means replacing the poster, the animated AVIF, the two pictures the conversation attaches, `durationMs`, the words that describe it (`clip`, and the plan in the conversation) and the social-preview images. |
| The creation conversation | [`creation-demo.tsx`](src/components/creation-demo.tsx) and its CSS, with words in `landing-en.ts` and `landing-ko.ts`. The example follows the video skill's intake (a reference video and a picture of what the ad is for), the plan, and approval before spending. What it attaches is what the concept clip was made from: a frame of the ad it took its look from, and the picture of its star. Its timing comes from the length of each line in the visitor's language (`demoSchedule`), so a translation cannot make two lines overlap, and its result is the concept clip itself, cropped to a band a little above the middle of the frame and played once through before the conversation starts again. It repeats only while visible, holds while hovered or focused, and shows the last scene with the poster under reduced motion and before any script runs. The animation is hidden from assistive technology; a visually hidden list carries the whole conversation instead. |
| A page | `src/pages/`: `landing`, `explore`, `mount*` (the page of an address: its name and description, how to connect an agent, then what it serves), `simple` (not found, bad address) |
| The steps to connect each client | [`src/components/connect-guide.tsx`](src/components/connect-guide.tsx) assembles the app picker, address, walkthrough and first message. [`connect-clients.ts`](src/components/connect-clients.ts) holds client metadata and setup commands. Words live in `src/i18n/messages/connect-en.ts` and `connect-ko.ts`, imported by the main packs. The behavior and official setup references are in [the connection guide spec](../../docs/specs/connect-guide.md). |
| Connection animations and client icons | [`connect-walkthrough.tsx`](src/components/connect-walkthrough.tsx) selects a desktop step and displays all steps vertically on mobile; [`connect-animation.tsx`](src/components/connect-animation.tsx) synchronizes repeating clicks, toggles and typing in [`connect-preview.tsx`](src/components/connect-preview.tsx). [`connect-preview-copy.tsx`](src/components/connect-preview-copy.tsx) keeps illustrated commands, configuration, names and addresses selectable and copyable. Mobile scrolls the app picker horizontally. These are local DOM illustrations with translated text. Icons ship under `public/clients/`, with their licenses in `public/licenses/` and the root notices. |
| How rendered Markdown from repositories looks | [`src/components/markdown.module.css`](src/components/markdown.module.css) |
| Words | [`src/i18n/messages/en.ts`](src/i18n/messages/en.ts) and [`ko.ts`](src/i18n/messages/ko.ts). English is the source; the Korean pack must have the same shape, and a test checks it. |
| Repository text in the visitor's language | [`src/i18n/repository-text.ts`](src/i18n/repository-text.ts): a skill's title and description, and a repository's name and description, from the `translations` their author wrote ([convention](../../docs/specs/skill-repo.md)), in the visitor's language when there is one and as written otherwise. A translated title stands in for a skill's name on the page; the name stays visible, since `get` takes it. |
| The brand | [`public/brand/symbol.svg`](public/brand/symbol.svg), [`public/brand/logo.svg`](public/brand/logo.svg), [`public/favicon.svg`](public/favicon.svg), and [`src/components/brand.tsx`](src/components/brand.tsx). Keep the branching symbol paths in sync. The wordmark uses the existing system font stack; no additional font is bundled. |
| The language list | [`language-switcher.tsx`](src/components/language-switcher.tsx): a native disclosure with real language links, saved preference, outside-click dismissal, and Escape returning focus. |
| Social-preview images | `public/og/og-<language>.png`, 1200 x 630. Replace the files, or restyle `src/pages/og-card.tsx` and take new screenshots of `/dev/og?lang=en` and `/dev/og?lang=ko` in a 1200 x 630 window (a headless browser with `--screenshot` and `--window-size=1200,630` does; force the language, since the page otherwise follows the browser's). Retake them whenever the hero copy or the poster changes. |
| What machines read | [`src/seo/head.ts`](src/seo/head.ts): title, description, canonical and alternate URLs, the social-preview tags and the structured data (the site as one organization, the application, the concept clip, and the questions). `renderLlmsTxt` in [`src/entry-server.tsx`](src/entry-server.tsx) writes `llms.txt` from the same words. The words themselves live in `meta` in the language packs; `meta.landing.about` is the one plain sentence that says what SkillCDN is. |

Styles are CSS modules: a class is local to its component, so renaming or restyling one cannot break another. Breakpoints are `40rem`, `52rem` and `60rem`.

## How it is built

`pnpm --filter @skillcdn/web run build` does three things: the client bundle, a self-contained bundle of `src/entry-server.tsx` that renders pages to HTML (`dist/render/entry-server.js`), and `scripts/prerender.mjs`, which writes into `dist/`:

- every static page once per language (`index.html`, `index.ko.html`, `explore/index.html`, ...), with its title, description, canonical and `hreflang` links, social-preview tags and structured data already in the HTML, because most crawlers do not run scripts;
- a shell for pages that depend on data, for a host that cannot render them;
- `template.html`, the document that pages are rendered into, kept for the server;
- `llms.txt` per language;
- `routes.json`, which tells whatever serves `dist/` which file answers which URL in which language, and names the render module.

The explorer view of an address is rendered by the server per request: it calls `renderAddressPage` from the render module with the language, the origin, the URL and the answers the page would ask the REST API for, and the page carries those answers in a JSON element (`#skillcdn-data`) so that the browser hydrates instead of loading them again (`src/api/initial-data.ts`, `src/api/use-resource.ts`). The head of that page (`src/seo/head.ts`) says whether it may be indexed: the overview of an address without a ref and one skill are; a ref, a file, a search or an index that is not ready are not.

Languages share their paths; `?lang=ko` forces Korean on that page, and a URL without a parameter is English to the server and to crawlers. In a browser such a URL is shown in the visitor's language instead, without the URL changing: `public/boot.js` hides the prerendered page when another language is wanted, and the app renders it in that language ([ADR-0013](../../docs/adr/0013-language-decided-in-the-browser-without-changing-the-url.md)). Links inside the app carry no language, whatever page they are on ([ADR-0015](../../docs/adr/0015-a-forced-language-holds-for-one-page.md)), and a language the URL forces becomes the visitor's preference ([ADR-0017](../../docs/adr/0017-a-forced-language-becomes-the-preference.md)). Pages carry a placeholder instead of the public origin, which the server fills in, so one build works on any domain. For a plain static host, build with `SKILLCDN_PUBLIC_URL=https://your.host` and the origin is written into the files; such a host serves the default language only.

## Adding a language

A pack in `src/i18n/messages/`, an entry in `src/i18n/languages.ts` and in `src/i18n/index.ts`, the code in the list in `public/boot.js`, and `public/og/og-<language>.png`. Tests fail until they all agree.

## Constraints

- **REST only.** The UI may import types, schemas and the address parser from `@skillcdn/core`, and nothing else from the workspace. The render module is the one thing the server calls, and it takes plain data.
- **Repository content is untrusted.** Markdown is rendered as React elements, never as HTML. Raw HTML stays text, links go to `http(s)`, `mailto` or another file of the same mount, and images are never loaded, because loading one tells a third party who is reading.
- **No inline scripts or styles**, so the pages work under a strict content security policy. The one exception is not in this workspace: the server may add an operator's tags to the head of every page (search-console verification, analytics; see `deploy/README.md`), and widens the policy for exactly those.
- **No secrets in the client.** Everything in a browser bundle is public.
- **No business model in the UI**: no plans, prices or checkout (root `CLAUDE.md`, rule 6).
