import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./app.js";
import { messagesFor } from "./i18n/index.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_INFO,
  LANGUAGE_PARAM,
  LANGUAGES,
  type Language,
  withLanguage,
} from "./i18n/languages.js";
import { matchRoute, PATHS } from "./router.js";
import { buildHead, renderHead } from "./seo/head.js";
import { LINKS, ORIGIN_PLACEHOLDER } from "./site.js";

// Build-time only: scripts/prerender.mjs imports the bundle made from this file and writes one
// HTML file per page and language. Nothing here runs in a browser or in the server.

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
}

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

/** A plain-text description of the site for language models, after the llms.txt convention. */
export function renderLlmsTxt(language: Language): string {
  const t = messagesFor(language);
  const origin = ORIGIN_PLACEHOLDER;
  const lines = [
    `# ${t.meta.siteName}`,
    "",
    `> ${t.meta.landing.description}`,
    "",
    t.landing.lead,
    "",
    `## ${t.landing.how.title}`,
    "",
    ...t.landing.how.steps.map((step, index) => `${index + 1}. **${step.title}.** ${step.body}`),
    "",
    `## ${t.landing.addresses.title}`,
    "",
    t.landing.addresses.lead,
    "",
    ...t.landing.addresses.rows.map((row) => `- \`${origin}${row.address}\`: ${row.meaning}`),
    "",
    `## ${t.landing.principles.title}`,
    "",
    ...t.landing.principles.items.map((item) => `- **${item.title}.** ${item.body}`),
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
