# apps/web: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) and this workspace's [`README.md`](README.md) first.

- **Ask before changing the look.** Visual direction, colors, the symbol and what the landing page says were decided with the maintainers (restrained developer tool, one blue accent, dark only, centered headers over left-aligned text, placeholder symbol). Restyle within that; ask before leaving it.
- **Tokens only.** No raw color, font stack or pixel size in a component's CSS: add or reuse a token in `src/styles/tokens.css`. The social-preview card is the one exception, because it is a picture.
- **Fonts ship with the image.** The content security policy allows no foreign source, so a font is added as a package and imported in `entry-client.tsx`. Never link a font from a CDN. Only Hangul has a webfont, because only Hangul needs one: `styles/pretendard.css` is generated from the package and narrowed to the Hangul ranges, and Latin is drawn by the system fonts in `--font-sans`. Do not edit that file by hand.
- **Every word goes through the language packs.** No user-visible string in a component. English is the source of truth; keep `ko.ts` in step in the same change, in natural Korean. The development-only pages are the exception. Language packs are the one place where committed text is not English.
- **Copy says what exists.** No prices or plans, no comparisons with other products, no promises about features that are not built. Naming an MCP client we work with is fine.
- **Same paths in every language.** The language is the `lang` query parameter; links inside the app go through `Link`, which keeps it. Never negotiate the language on the server or from `Accept-Language` (ADR-0009).
- **Pages that should be found are rendered on the server.** A new static page is added to `STATIC_PAGES` in `src/entry-server.tsx` and gets a head in `src/seo/head.ts`; the view of an address is rendered per request through `renderAddressPage`. Whatever renders on the server must render the same in the browser: no `window`, `Date.now()` or storage during render; read them in effects. A page that loads data asks for it through `useResource` with a key from `src/api/keys.ts`, which is how the server's answers reach it.
- **Repository content is hostile.** It reaches the DOM only through `components/markdown.tsx` or as text. Never `dangerouslySetInnerHTML`, never an `<img>` or `<iframe>` whose source comes from a repository.
- **No inline `style` attributes and no inline scripts**: the server sends a content security policy that forbids them.
- **The REST API is the only backend.** Responses are parsed with the schemas from `@skillcdn/core`. When the contract changes, `dev/fixtures.ts` changes with it; `dev/fixture-api.test.ts` fails until it does.
- **New runtime dependencies need a reason** in the commit message, like everywhere else. The main bundle is what every visitor downloads: what only the explorer needs is loaded with it (`lazy` in `src/app.tsx`).

## Gotchas

- Biome rewrites `import "./x.css"` to `./x.js` (`useImportExtensions`). Style sheets that are imported for their side effect carry a `biome-ignore` for that; CSS modules are not affected.
- Adjacent expressions in JSX (`{host}{path}`) become separate text nodes with a comment between them in prerendered HTML. Write one template string when the text must be searchable as a whole.
- There is one theme and it is dark: `tokens.css` sets `color-scheme: dark` and every color is a single value. Nothing reads or writes `data-theme`.
- Text reads from the left. What is centered says so in its own rule and is always a header: the landing hero, a section title and its lead, the head of a page, the short pages (not found, bad address), the header bar and the footer.
- Headless Chrome will not make a window narrower than about 500 px; to check a phone width, load the page in a 390 px wide iframe.
- The render bundle imports `pages/mount.tsx` statically while the client loads it lazily; the build warns that the dynamic import is ineffective in that bundle. It is meant to be.
- The server hydrates the page of an address only when `#skillcdn-data` is there and `data-prerendered` names the route; otherwise the browser renders afresh. A mismatch between what the server and the browser render shows up as a hydration warning in the console: check `useResource` gets the same answers on both sides.
