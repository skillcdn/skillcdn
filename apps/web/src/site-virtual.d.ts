// The configuration a build was given (dev/site-config.ts, ADR-0099): the file
// `SKILLCDN_WEB_CONFIG` names, or `site-config.default.ts`.

declare module "virtual:skillcdn-site" {
  import type { SiteConfig } from "./site-pages.js";

  export const site: SiteConfig;
}
