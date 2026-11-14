import { site as configured } from "virtual:skillcdn-site";
import { createContext, useContext } from "react";
import type { SiteConfig, SitePage } from "./site-pages.js";

// The configuration this build was made with (ADR-0099): the file `SKILLCDN_WEB_CONFIG` named
// when the pages were built, or the product's own, which has no pages (dev/site-config.ts).
// The pages read it from the context, so that a test renders the app with another.

/** What the build was configured with. */
export const SITE: SiteConfig = configured;

/** The pages of the installation's own the build was configured with. */
export const SITE_PAGES: readonly SitePage[] = SITE.pages ?? [];

export const SiteContext = createContext<SiteConfig>(SITE);

/** The pages of the installation's own, in the order the menu names them. */
export function useSitePages(): readonly SitePage[] {
  return useContext(SiteContext).pages ?? [];
}
