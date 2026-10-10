<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/brand</h1>
<p align="center">The pictures of the SkillCDN brand as files: the symbol, the wordmark, the lockup and the icons made from them.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@skillcdn/brand"><img alt="npm" src="https://img.shields.io/npm/v/@skillcdn/brand"></a>
  <a href="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/skillcdn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/skillcdn/blob/main/TRADEMARKS.md"><img alt="Terms: the SkillCDN trademark policy" src="https://img.shields.io/badge/terms-trademark%20policy-3a6dd4"></a>
</p>

[SkillCDN](https://skillcdn.ai) turns any git repository into an MCP server. This package is its brand as files, so that a page that may show the SkillCDN marks shows the same ones as skillcdn.ai, from one place, instead of a copy of its own. The marks are not open source: [LICENSE.md](LICENSE.md) says what they are and under what terms, and the terms, the SkillCDN Trademark Policy, ship with the package as `TRADEMARKS.md`. Read them before you install.

```sh
npm install @skillcdn/brand
```

## The files

Every file is the one shape, from the path data in [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core) (`BRAND_SYMBOL_PATH`, `BRAND_WORDMARK_PATH`). The symbol is always in its own blue, `#3a6dd4`; the wordmark is black on a light ground and white on a dark one, and in no other colour.

| File | What it is |
|---|---|
| `symbol.svg`, `symbol.png` (512 by 512) | The symbol alone, transparent around it. |
| `wordmark-black.svg`, `wordmark-white.svg` | The wordmark alone, for a light and for a dark ground. |
| `logo-black.svg`, `logo-black.png` (1200 by 199) | The lockup, symbol and wordmark together, for a light ground: the one to name where a form asks for the logo. |
| `logo-white.svg`, `logo-white.png` (1200 by 199) | The lockup for a dark ground. |
| `avatar.png` (1024 by 1024) | The symbol with room around it, transparent: an account picture, which a platform rounds and rings. |
| `banner.png` (1200 by 600) | The lockup on the ground SkillCDN's pages open on, `#0b1019`, at two to one: a picture of the site where one is wanted, such as the header of a profile. |
| `favicon.svg`, `favicon.ico` (16, 32 and 48) | The symbol as a page's icon, transparent. |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | The symbol on the pages' ground, opaque, with the margin a maskable icon needs: for a home screen, an app list, a web app manifest. |

Every transparent picture keeps the ground it is meant for under its transparent pixels (white, and black under `logo-white.png`), so that a reader which drops the alpha channel shows it on that ground rather than on black.

## Using them

The package has no code and no entry point: each file is imported by its path, and a bundler gives back its address.

```ts
import symbol from "@skillcdn/brand/symbol.svg";
import wordmark from "@skillcdn/brand/wordmark-white.svg";
```

For a page's icons, copy the files next to the page and link them as usual:

```html
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

Show the marks as they are: the symbol in its blue, the wordmark in black or white, the lockup with the room the files give it, nothing recoloured, stretched or altered. Where a mark is drawn rather than shown, draw it from the path data in `@skillcdn/core`, as skillcdn.ai does.

## Terms

The files are trademarks and copyrighted works of KDX Labs Corp. They are not licensed under the FSL-1.1-ALv2 of the SkillCDN source code, nor under the license of whatever depends on this package. The [SkillCDN Trademark Policy](https://github.com/skillcdn/skillcdn/blob/main/TRADEMARKS.md) says what you may do without asking and what needs written permission; [LICENSE.md](LICENSE.md) applies it to these files. Showing them is right where the policy allows it and wrong where it does not, whatever installed them.

To say that a repository is served by SkillCDN, show the badge a deployment serves for its address (`/badge/<address>`, [REST](https://github.com/skillcdn/skillcdn/blob/main/docs/specs/rest.md#get-badgeaddress)), as served and linked to that address: the policy allows it, it carries the symbol and says where the repository is served, and it is not in this package.

## Where they come from

The SVG files are the path data of `@skillcdn/core` written out, and `scripts/render.mjs` draws every raster file from the same data (`pnpm --filter @skillcdn/brand run render`, with `core` built); `brand.test.ts` keeps every file equal to it. A change of a mark is a change of the path data in `core`, a run of the script, and a release of both packages.
