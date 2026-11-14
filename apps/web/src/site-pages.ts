import type { SkillCdnClient } from "@skillcdn/client";
import type { ReactNode } from "react";
import type { Messages } from "./i18n/messages/en.js";

// Pages of an installation's own (ADR-0099). Every installation needs screens around its packs
// that are nobody else's: what its operator looks at, how its people get a pack made. They are
// not the product's to ship, and they used to need a fork of this workspace. A build is given a
// configuration instead (`SKILLCDN_WEB_CONFIG`, a file that says `export const site = defineSite(...)`),
// and each page it names gets an address, `/pages/<key>`, a place in the header's menu where it
// asks for one, and what the pages of the product are given: the REST client, the language and
// its words, the origin, and the way to move between pages.
//
// Such a page is drawn in the browser alone and is never one for a search engine: the server
// answers its address with the frame, and the page draws itself once the frame is up. This
// module is what a configuration imports, as `@skillcdn/web`.

/** Where the pages of an installation's own live. */
export const SITE_PAGES_PATH = "/pages";

/** What a page is told apart by, and what its address says: lowercase letters, digits and hyphens. */
const PAGE_KEY = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** How a page moves to another page of the deployment without loading a document. */
export interface SiteNavigation {
  /** Shows the address, as one more step in the history. */
  go(href: string): void;
  /** Shows the address in place of the one shown. */
  replace(href: string): void;
}

/** What a page of an installation's own is given: what the pages of the product are given. */
export interface SitePageContext {
  /** The REST API of the deployment the page is served from, as the person in the browser. */
  readonly client: SkillCdnClient;
  /** The tag of the language the pages are shown in: `en`, `ko`. */
  readonly language: string;
  /** The words of the product's pages in that language, for what a page says as they do. */
  readonly words: Messages;
  /** The public origin of the deployment, for an address a person copies. */
  readonly origin: string;
  /** The query of the page's address, `?` included, or empty: where a page keeps what it shows. */
  readonly search: string;
  readonly navigation: SiteNavigation;
}

export interface SitePage {
  /** What the address says, `/pages/<key>`, and what tells the page apart. */
  readonly key: string;
  /** What the page is called: one word for every language, or a word by language tag, `en` standing in for a tag without one. */
  readonly label: string | Readonly<Record<string, string>>;
  /** Whether the header's menu names the page. Left out, the page is reached by its address. */
  readonly menu?: boolean | undefined;
  /** Whether the page takes the whole width of the window, as the documentation does. */
  readonly wide?: boolean | undefined;
  /** What the page shows. Called in the browser, never where the pages are rendered to HTML. */
  readonly render: (context: SitePageContext) => ReactNode;
}

/** What a build is told of the installation it is for. */
export interface SiteConfig {
  /** Pages of the installation's own, in the order the menu names them. */
  readonly pages?: readonly SitePage[] | undefined;
}

/**
 * A configuration, checked: a key the address grammar takes, and no key twice. A build with a
 * configuration that is not one fails here, and says which page.
 */
export function defineSite(config: SiteConfig): SiteConfig {
  const seen = new Set<string>();
  for (const page of config.pages ?? []) {
    if (!PAGE_KEY.test(page.key)) {
      throw new Error(
        `a page's key is lowercase letters, digits and hyphens, at most 64 characters: ${JSON.stringify(page.key)}`,
      );
    }
    if (seen.has(page.key)) {
      throw new Error(`two pages have the key ${page.key}`);
    }
    seen.add(page.key);
    if (sitePageLabel(page, "en").trim().length === 0) {
      throw new Error(`the page ${page.key} has no label`);
    }
  }
  return config;
}

/** The address of a page of an installation's own. */
export function sitePageHref(key: string): string {
  return `${SITE_PAGES_PATH}/${key}`;
}

/** What a page is called in a language: its word for the tag, else for `en`, else the first it has. */
export function sitePageLabel(page: SitePage, language: string): string {
  if (typeof page.label === "string") {
    return page.label;
  }
  return page.label[language] ?? page.label.en ?? Object.values(page.label)[0] ?? "";
}

/** The page a path is the address of, among the pages given; `undefined` for any other path. */
export function sitePageAt(pages: readonly SitePage[], pathname: string): SitePage | undefined {
  const prefix = `${SITE_PAGES_PATH}/`;
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const key = pathname.slice(prefix.length);
  return pages.find((page) => page.key === key);
}
