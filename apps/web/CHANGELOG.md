# @skillcdn/web

## 0.5.1

### Patch Changes

- [`ed9b114`](https://github.com/skillcdn/skillcdn/commit/ed9b114346b27a1ff9de5d3780125ef59fba5992) Thanks [@samo-lucid](https://github.com/samo-lucid)! - The web UI of a deployment is a package now (ADR-0101): the pages with the command that builds them, so that an installation adds screens of its own (ADR-0099) from a version rather than a checkout of the repository. `npm install @skillcdn/web vite @vitejs/plugin-react`, a configuration that names the pages (`defineSite` from this package), then `skillcdn-web build --config site.config.tsx --out web` makes the directory the server serves from `WEB_ROOT`; `skillcdn-web dev` serves the pages while they are written, against fixtures or a deployment. The package carries the documentation of its release, which the pages publish under `/docs`, the license, the trademark policy and the notices. Take the version of the image the deployment runs.
- Updated dependencies [[`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4), [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390), [`4416e43`](https://github.com/skillcdn/skillcdn/commit/4416e43a3a184aa5ced2bbe657198faf054dc9ae), [`6b050be`](https://github.com/skillcdn/skillcdn/commit/6b050bef6e52bdb454f949a8eaf31bdd07706536), [`1475fc3`](https://github.com/skillcdn/skillcdn/commit/1475fc3f296daec0b2cae0140fa1b911df1e3f54), [`6010c2f`](https://github.com/skillcdn/skillcdn/commit/6010c2f50a9f2bf53a0b0dc37b4e2dbad1db0a45), [`75bfccf`](https://github.com/skillcdn/skillcdn/commit/75bfccf4c6c2218bac98a561dfb0b825be47e70b)]:
  - @skillcdn/core@0.5.1
  - @skillcdn/brand@0.5.1
  - @skillcdn/client@0.5.1
