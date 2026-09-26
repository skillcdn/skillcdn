# Third-party notices

What ships inside the image or the web build under a license of its own, beyond the npm packages, whose licenses travel with them in `node_modules`. Every entry here is bundled on purpose: an installation may have no internet, and the pages allow no foreign source, so a font or an asset can only reach a visitor from the image itself. The rules for adding one are in [`CLAUDE.md`](CLAUDE.md), under Dependencies.

## Pretendard

The typeface that draws Hangul in the web UI (`apps/web`), shipped as unmodified subset font files in the web build.

- Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard), with Reserved Font Name "Pretendard". Its license file also carries the notices of the fonts it is derived from: Adobe (Reserved Font Name "Source"), The Inter Project Authors ("Inter") and The M+ FONTS Project Authors ("M PLUS 1").
- License: SIL Open Font License, Version 1.1 (`OFL-1.1`). The full text with every copyright notice ships with the fonts as `licenses/pretendard.txt` in the web build ([`apps/web/public/licenses/pretendard.txt`](apps/web/public/licenses/pretendard.txt)), and the font files carry it in their metadata as well.
- What the license asks of us: the font files stay unmodified, so the Reserved Font Names may be kept; they are never sold or distributed on their own, only as part of the software; the notice stays with them. Nothing in it applies to the pages set in the font or to the rest of this repository.

## Lobe Icons

The OpenAI, Claude, Cursor, Windsurf, Codex and Gemini marks in `apps/web/public/clients/` identify the clients supported by the connection guide.

- Source: [Lobe Icons](https://github.com/lobehub/lobe-icons/tree/2e76c48721e91b9aaa40803a0fa2eb8aca7399c4/packages/static-svg/icons), snapshot `2e76c48721e91b9aaa40803a0fa2eb8aca7399c4`. Claude and Gemini use the color variants (`claude-color.svg`, `gemini-color.svg`). The files are byte for byte as the source ships them; the pages show them as images, so nothing in them meets the content security policy.
- Copyright (c) 2023 LobeHub. License: MIT; the complete notice ships as [`licenses/lobe-icons.txt`](apps/web/public/licenses/lobe-icons.txt).
- Product names and marks belong to their respective owners. Their use identifies interoperability and does not imply endorsement.

## Devicon

The VS Code mark in `apps/web/public/clients/vscode.svg`.

- Source: [Devicon, vscode-original.svg](https://github.com/devicons/devicon/blob/65476530e1afea9b1f850efb1cc0efec19ee0ef0/icons/vscode/vscode-original.svg), as of commit `65476530e1afea9b1f850efb1cc0efec19ee0ef0`, retrieved September 26, 2026, unmodified.
- Copyright (c) 2015 konpa. License: MIT; the complete notice ships as [`licenses/devicon.txt`](apps/web/public/licenses/devicon.txt).
- The mark identifies the supported client; trademark rights remain with its owner.

## npm packages in the web build

The pages bundle npm packages, each under its own permissive license. The build writes their licenses and notices to `licenses/npm.txt` in the web build (`apps/web/scripts/collect-licenses.mjs`), served next to the pages at `/licenses/npm.txt`, and `pnpm check` refuses a production dependency whose license is not on the allowlist (`scripts/check-licenses.mjs`). The server's own dependencies travel with it in `node_modules`, licenses included.

## Showcase media

The concept clip and the pictures in `apps/web/public/showcase/` are original AI-generated concept media made for this project on September 23, 2026 and re-encoded for the web. They depict no real product, run or person, and the page says so next to the clip. The originals carry content credentials that the re-encoding did not keep; a regenerated clip must carry them through, which is on the [roadmap](docs/roadmap.md).
