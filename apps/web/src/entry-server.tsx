import type { RestMount, RestSkill } from "@skillcdn/core";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { type InitialData, type InitialResource, renderInitialData } from "./api/initial-data.js";
import { resourceKeys } from "./api/keys.js";
import { App } from "./app.js";
import { messagesFor } from "./i18n/index.js";
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGE_INFO,
  LANGUAGE_PARAM,
  LANGUAGES,
  type Language,
  withLanguage,
} from "./i18n/languages.js";
import { MountPage } from "./pages/mount.js";
import { matchRoute, PATHS } from "./router.js";
import { buildHead, type PageData, renderHead } from "./seo/head.js";
import { FEATURED_VIDEO, LINKS, ORIGIN_PLACEHOLDER } from "./site.js";

// Rendering to HTML, without a browser. scripts/prerender.mjs imports the bundle made from this
// file at build time and writes one file per static page and language; the server imports the
// same bundle from the build and calls renderAddressPage for the view of an address, with the
// answers the page needs (ADR-0009, ADR-0011).

export { DEFAULT_LANGUAGE, LANGUAGE_PARAM, LANGUAGES, ORIGIN_PLACEHOLDER };

/** Pages that do not depend on data and are therefore prerendered completely. */
export const STATIC_PAGES = [
  { name: "landing", path: PATHS.landing, file: "index", indexable: true },
  { name: "explore", path: PATHS.explore, file: "explore/index", indexable: true },
] as const;

export interface RenderedPage {
  readonly htmlLang: string;
  readonly head: string;
  readonly body: string;
  /** What the page was rendered as. The client hydrates only when it agrees. */
  readonly routeName: string;
  /** Answers the page was rendered with, for the browser to continue from. */
  readonly initialData?: InitialData;
}

/** The markers in index.html that a rendered page fills. */
export const TEMPLATE_MARKERS = {
  htmlLang: '<html lang="en">',
  head: "<!--app-head-->",
  root: '<div id="root"><!--app-html--></div>',
} as const;

function render(path: string, language: Language, shell: boolean): RenderedPage {
  const search = withLanguage(path, language).slice(path.length);
  const route = matchRoute(path, search);
  const head = buildHead(shell ? { name: "not-found" } : route, language, ORIGIN_PLACEHOLDER);
  return {
    htmlLang: LANGUAGE_INFO[language].htmlLang,
    // The shell stands in for pages it knows nothing about yet; the browser fills in the rest.
    head: renderHead(shell ? { ...head, title: messagesFor(language).meta.siteName } : head),
    body: renderToString(
      <StrictMode>
        <App
          initialLocation={{ pathname: path, search }}
          origin={ORIGIN_PLACEHOLDER}
          shell={shell}
        />
      </StrictMode>,
    ),
    routeName: shell ? "shell" : route.name,
  };
}

export function renderPage(path: string, language: Language): RenderedPage {
  return render(path, language, false);
}

/**
 * The frame without a page: served for routes that are rendered in the browser. It is rendered
 * at the front page's location so that the links in the frame are real ones.
 */
export function renderShell(language: Language): RenderedPage {
  return render(PATHS.landing, language, true);
}

export function renderNotFound(language: Language): RenderedPage {
  return render("/this-page-does-not-exist", language, false);
}

/**
 * A rendered page in the document template (index.html as the client build wrote it). The root
 * says which page and which language it holds, where no script before the app touches it: the
 * browser hydrates only what matches (entry-client.tsx), whichever URL the server served it at.
 */
export function renderDocument(template: string, page: RenderedPage): string {
  const data = page.initialData === undefined ? "" : renderInitialData(page.initialData);
  return template
    .replace(TEMPLATE_MARKERS.htmlLang, `<html lang="${page.htmlLang}">`)
    .replace(TEMPLATE_MARKERS.head, page.head)
    .replace(
      TEMPLATE_MARKERS.root,
      `<div id="root" data-prerendered="${page.routeName}" data-lang="${page.htmlLang}">${page.body}</div>${data}`,
    );
}

/** What the server knows when it renders the view of an address. */
export interface AddressPageInput {
  /**
   * The language the server chose: the URL's, else the one the request asked for (ADR-0021).
   * One we do not have falls back to the default language.
   */
  readonly language: string;
  /** The public origin of this deployment. */
  readonly origin: string;
  /** The path of the address, as requested. */
  readonly pathname: string;
  /** The query string, `?` included, or empty. */
  readonly search: string;
  /** The answers the page would ask the REST API for: what the address serves, and one skill. */
  readonly data: {
    readonly mount?: InitialResource | undefined;
    readonly skill?: InitialResource | undefined;
  };
}

export interface AddressPageOutput {
  readonly html: string;
  /** Whether the page told search engines they may index it. */
  readonly indexable: boolean;
}

/**
 * The explorer view of an address, rendered with its data so that a crawler reads the page as a
 * person would see it, and the browser takes over where the server left off.
 */
export function renderAddressPage(template: string, input: AddressPageInput): AddressPageOutput {
  const language = isLanguage(input.language) ? input.language : DEFAULT_LANGUAGE;
  const route = matchRoute(input.pathname, input.search);
  const initialData: Record<string, InitialResource> = {};
  const pageData: { mount?: RestMount; skill?: RestSkill } = {};
  if (route.name === "mount") {
    const { address, view } = route;
    if (input.data.mount !== undefined) {
      initialData[resourceKeys.mount(address)] = input.data.mount;
      if (input.data.mount.ready !== undefined) {
        pageData.mount = input.data.mount.ready as RestMount;
      }
    }
    if (view.kind === "skill" && input.data.skill !== undefined) {
      initialData[resourceKeys.skill(address, view.name)] = input.data.skill;
      if (input.data.skill.ready !== undefined) {
        pageData.skill = input.data.skill.ready as RestSkill;
      }
    }
  }
  const head = buildHead(route, language, input.origin, pageData satisfies PageData);
  // A URL without a language is rendered in the one the server chose, as the browser shows it in
  // the one its visitor prefers.
  const body = renderToString(
    <StrictMode>
      <App
        initialLocation={{ pathname: input.pathname, search: input.search }}
        origin={input.origin}
        initialData={initialData}
        mountPage={MountPage}
        preferredLanguage={language}
      />
    </StrictMode>,
  );
  const html = renderDocument(template, {
    htmlLang: LANGUAGE_INFO[language].htmlLang,
    head: renderHead(head),
    body,
    routeName: route.name,
    initialData,
  });
  return { html, indexable: head.indexable };
}

/**
 * A plain-text description of the site for language models, after the llms.txt convention: what
 * it is in one sentence, what there is to make, how it goes, and where the pages are.
 */
export function renderLlmsTxt(language: Language): string {
  const t = messagesFor(language);
  const origin = ORIGIN_PLACEHOLDER;
  const featured = t.landing.featured.video;
  const lines = [
    `# ${t.meta.siteName}`,
    "",
    `> ${t.meta.landing.description}`,
    "",
    t.meta.landing.about,
    "",
    t.landing.lead,
    "",
    `## ${t.landing.featured.title}`,
    "",
    `- [${featured.title}](${origin}${FEATURED_VIDEO.href}): ${featured.body} ${featured.requirement}.`,
    "",
    `## ${t.landing.how.title}`,
    "",
    ...t.landing.how.steps.map((step, index) => `${index + 1}. **${step.title}** ${step.body}`),
    "",
    `## ${t.landing.start.title}`,
    "",
    ...t.landing.start.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    `## ${t.address.label}`,
    "",
    `- \`${origin}/gh/owner/repo\`: ${t.address.hint}`,
    `- ${t.connect.copyTitle}: ${t.connect.copyHint}`,
    "",
    `## ${t.landing.faq.title}`,
    "",
    ...t.landing.faq.items.flatMap((item) => [`### ${item.question}`, "", item.answer, ""]),
    `## ${t.nav.docs}`,
    "",
    `- [${t.explore.title}](${origin}${withLanguage(PATHS.explore, language)}): ${t.explore.lead}`,
    `- [${t.landing.authors.convention}](${LINKS.convention})`,
    `- [${t.footer.source}](${LINKS.repository})`,
    `- [${t.footer.license}](${LINKS.license})`,
    "",
  ];
  return lines.join("\n");
}
