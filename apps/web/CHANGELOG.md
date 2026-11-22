# @skillcdn/web

## 0.6.1

### Patch Changes

- Updated dependencies [[`08ee032`](https://github.com/skillcdn/skillcdn/commit/08ee032f7475c37c041904c12006990b3f469912), [`c752fe1`](https://github.com/skillcdn/skillcdn/commit/c752fe113d1c46095506fb44b9857bed8d517c5f)]:
  - @skillcdn/core@0.6.1
  - @skillcdn/brand@0.6.1
  - @skillcdn/client@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [[`67e9d7d`](https://github.com/skillcdn/skillcdn/commit/67e9d7dadd0a58d9f28657f5f79ada1cccb3fda8), [`669e216`](https://github.com/skillcdn/skillcdn/commit/669e2167f754a1fa53cdde037e906dba71e10213), [`9cce1dd`](https://github.com/skillcdn/skillcdn/commit/9cce1dd5af2481a23cbe8239f007c8ed63fb2381), [`59a1ecd`](https://github.com/skillcdn/skillcdn/commit/59a1ecd5affa553f5e63ef3ea591d4a734c015a8), [`7e803b6`](https://github.com/skillcdn/skillcdn/commit/7e803b60a76015f93d809bf8a2b5362bae94593d)]:
  - @skillcdn/core@0.6.0
  - @skillcdn/brand@0.6.0
  - @skillcdn/client@0.6.0

## 0.5.3

### Patch Changes

- [`ba20e73`](https://github.com/skillcdn/skillcdn/commit/ba20e732cb9b208fae65fe519b2d397a4839b496) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn use` says whether the `.skillcdn.json` it wrote is committed, before anything commits it: it is, so that every clone reads the same pack, unless the repository is public and the file names a deployment of your own or a private pack, which the organization keeps to itself; such a file goes in `.gitignore`, and each clone runs `skillcdn use` once. The command's help, its README and the guide on using skills say the same.

- [`d108017`](https://github.com/skillcdn/skillcdn/commit/d1080173e8b399f27493226247bb649478b5074b) Thanks [@dependabot[bot]](https://github.com/dependabot%5Bbot%5D)! - Asks for `@vitejs/plugin-react` 6.3.0 at least as its peer: the release the pages are built and tested with. An installation that holds an older 6 updates it together with the package. Nothing changes in the pages or in how `skillcdn-web build` is used.

- [`cf48c31`](https://github.com/skillcdn/skillcdn/commit/cf48c31228ec62e3e82453ec3a0c6790fae9d03e) Thanks [@dependabot[bot]](https://github.com/dependabot%5Bbot%5D)! - Asks for `vite` 8.3.8 at least as its peer: the release the pages are built and tested with. An installation that holds an older Vite 8 updates it together with the package. Nothing changes in the pages or in how `skillcdn-web build` is used.
- Updated dependencies [[`a042163`](https://github.com/skillcdn/skillcdn/commit/a04216367ec8390a6ebbddf3a55b6a7c29b45f09), [`f86a5db`](https://github.com/skillcdn/skillcdn/commit/f86a5db7a720cdb458dd69bf160e414c934c6094), [`616989e`](https://github.com/skillcdn/skillcdn/commit/616989ea3b6793001ad841ee35a0207ad967c434)]:
  - @skillcdn/core@0.5.3
  - @skillcdn/brand@0.5.3
  - @skillcdn/client@0.5.3

## 0.5.2

### Patch Changes

- [`ee03669`](https://github.com/skillcdn/skillcdn/commit/ee03669b162727e7eac7e389cb12a99a12588b7c) Thanks [@samo-lucid](https://github.com/samo-lucid)! - `skillcdn use` prints a sentence for the checkout's agreement that has an agent run `skillcdn status` before its first step, and names `AGENTS.md` first, or `CLAUDE.md` where that is the file the agents read; the connection guide of the pages says the same. A checkout that carries the earlier sentence keeps working: copy the new one into it to have its agents look at what the checkout reads before they begin.
- Updated dependencies [[`c7b1640`](https://github.com/skillcdn/skillcdn/commit/c7b1640441bfdcacd1ccf795466be3b382353e02), [`f5cf4dd`](https://github.com/skillcdn/skillcdn/commit/f5cf4dde7d45f200b9a531d2313cd4e8ce324145)]:
  - @skillcdn/core@0.5.2
  - @skillcdn/brand@0.5.2
  - @skillcdn/client@0.5.2

## 0.5.1

### Patch Changes

- [`ed9b114`](https://github.com/skillcdn/skillcdn/commit/ed9b114346b27a1ff9de5d3780125ef59fba5992) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The web UI of a deployment is a package now (ADR-0101): the pages with the command that builds them, so that an installation adds screens of its own (ADR-0099) from a version rather than a checkout of the repository. `npm install @skillcdn/web vite @vitejs/plugin-react`, a configuration that names the pages (`defineSite` from this package), then `skillcdn-web build --config site.config.tsx --out web` makes the directory the server serves from `WEB_ROOT`; `skillcdn-web dev` serves the pages while they are written, against fixtures or a deployment. The package carries the documentation of its release, which the pages publish under `/docs`, the license, the trademark policy and the notices. Take the version of the image the deployment runs.
- Updated dependencies [[`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4), [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390), [`4416e43`](https://github.com/skillcdn/skillcdn/commit/4416e43a3a184aa5ced2bbe657198faf054dc9ae), [`6b050be`](https://github.com/skillcdn/skillcdn/commit/6b050bef6e52bdb454f949a8eaf31bdd07706536), [`1475fc3`](https://github.com/skillcdn/skillcdn/commit/1475fc3f296daec0b2cae0140fa1b911df1e3f54), [`6010c2f`](https://github.com/skillcdn/skillcdn/commit/6010c2f50a9f2bf53a0b0dc37b4e2dbad1db0a45), [`75bfccf`](https://github.com/skillcdn/skillcdn/commit/75bfccf4c6c2218bac98a561dfb0b825be47e70b)]:
  - @skillcdn/core@0.5.1
  - @skillcdn/brand@0.5.1
  - @skillcdn/client@0.5.1
