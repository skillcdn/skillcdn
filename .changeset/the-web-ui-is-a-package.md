---
"@skillcdn/web": patch
---

The web UI of a deployment is a package now (ADR-0101): the pages with the command that builds them, so that an installation adds screens of its own (ADR-0099) from a version rather than a checkout of the repository. `npm install @skillcdn/web vite @vitejs/plugin-react`, a configuration that names the pages (`defineSite` from this package), then `skillcdn-web build --config site.config.tsx --out web` makes the directory the server serves from `WEB_ROOT`; `skillcdn-web dev` serves the pages while they are written, against fixtures or a deployment. The package carries the documentation of its release, which the pages publish under `/docs`, the license, the trademark policy and the notices. Take the version of the image the deployment runs.
