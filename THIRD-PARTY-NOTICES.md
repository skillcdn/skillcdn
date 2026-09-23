# Third-party notices

What ships inside the image or the web build under a license of its own, beyond the npm packages, whose licenses travel with them in `node_modules`. Every entry here is bundled on purpose: an installation may have no internet, and the pages allow no foreign source, so a font or an asset can only reach a visitor from the image itself. The rules for adding one are in [`CLAUDE.md`](CLAUDE.md), under Dependencies.

## Pretendard

The typeface that draws Hangul in the web UI (`apps/web`), shipped as unmodified subset font files in the web build.

- Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard), with Reserved Font Name "Pretendard". Its license file also carries the notices of the fonts it is derived from: Adobe (Reserved Font Name "Source"), The Inter Project Authors ("Inter") and The M+ FONTS Project Authors ("M PLUS 1").
- License: SIL Open Font License, Version 1.1 (`OFL-1.1`). The full text with every copyright notice ships with the fonts as `licenses/pretendard.txt` in the web build ([`apps/web/public/licenses/pretendard.txt`](apps/web/public/licenses/pretendard.txt)), and the font files carry it in their metadata as well.
- What the license asks of us: the font files stay unmodified, so the Reserved Font Names may be kept; they are never sold or distributed on their own, only as part of the software; the notice stays with them. Nothing in it applies to the pages set in the font or to the rest of this repository.

## Lobe Icons

The OpenAI, Claude, Cursor, Windsurf, Codex and Gemini marks in `apps/web/public/clients/` identify the clients supported by the connection guide.

- Source: [Lobe Icons](https://github.com/lobehub/lobe-icons/tree/2e76c48721e91b9aaa40803a0fa2eb8aca7399c4/packages/static-svg/icons), snapshot `2e76c48721e91b9aaa40803a0fa2eb8aca7399c4`. Claude and Gemini use the color variants. Redundant inline style attributes are removed for the content security policy; paths and colors are preserved.
- Copyright (c) 2023 LobeHub. License: MIT; the complete notice ships as [`licenses/lobe-icons.txt`](apps/web/public/licenses/lobe-icons.txt).
- Product names and marks belong to their respective owners. Their use identifies interoperability and does not imply endorsement.

## Devicon

The VS Code mark in `apps/web/public/clients/vscode.svg`.

- Source: [Devicon, vscode-original.svg](https://github.com/devicons/devicon/blob/master/icons/vscode/vscode-original.svg), retrieved September 23, 2026.
- Copyright (c) 2015 konpa. License: MIT; the complete notice ships as [`licenses/devicon.txt`](apps/web/public/licenses/devicon.txt).
- The mark identifies the supported client; trademark rights remain with its owner.
