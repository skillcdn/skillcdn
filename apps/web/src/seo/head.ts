import { messagesFor } from "../i18n/index.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_INFO,
  LANGUAGES,
  type Language,
  withLanguage,
} from "../i18n/languages.js";
import { PATHS, type Route } from "../router.js";
import { LINKS } from "../site.js";

// What a crawler reads before it reads the page: title, description, which URL is canonical,
// where the other languages are, the social preview, and structured data. Built as data so it can
// be tested, rendered into prerendered pages, and applied in the browser after a navigation.

export interface PageHead {
  readonly language: Language;
  readonly title: string;
  readonly description: string;
  /** Pages that depend on a repository are not for search indexes (ADR-0009). */
  readonly indexable: boolean;
  /** Absolute URL of this page in this language. Only indexable pages have one. */
  readonly canonical: string | undefined;
  /** Every language of this page, plus `x-default`. Empty when the page is not indexable. */
  readonly alternates: readonly { readonly hreflang: string; readonly href: string }[];
  readonly image: { readonly url: string; readonly alt: string };
  readonly jsonLd: readonly Record<string, unknown>[];
}

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** The path of a route that exists once per language, without a language. */
export function indexablePathOf(route: Route): string | undefined {
  return route.name === "landing"
    ? PATHS.landing
    : route.name === "explore"
      ? PATHS.explore
      : undefined;
}

export function buildHead(route: Route, language: Language, origin: string): PageHead {
  const t = messagesFor(language);
  const path = indexablePathOf(route);
  const urlIn = (code: Language) =>
    path === undefined ? undefined : `${origin}${withLanguage(path, code)}`;
  const canonical = urlIn(language);

  const repository = route.name === "mount" ? `${route.address.owner}/${route.address.repo}` : "";
  const text =
    route.name === "landing"
      ? t.meta.landing
      : route.name === "explore"
        ? t.meta.explore
        : route.name === "mount"
          ? {
              title: t.meta.mount.title(repository),
              description: t.meta.mount.description(repository),
            }
          : route.name === "states" || route.name === "og-card"
            ? { title: t.meta.siteName, description: "" }
            : route.name === "bad-address"
              ? { title: `${t.address.invalid} | ${t.meta.siteName}`, description: "" }
              : t.meta.notFound;

  const jsonLd: Record<string, unknown>[] = [];
  if (route.name === "landing" && canonical !== undefined) {
    const inLanguage = LANGUAGE_INFO[language].htmlLang;
    jsonLd.push(
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: t.meta.siteName,
        url: canonical,
        description: t.meta.landing.description,
        inLanguage,
      },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: t.meta.siteName,
        url: canonical,
        description: t.meta.landing.description,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        license: LINKS.license,
        inLanguage,
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        inLanguage,
        mainEntity: t.landing.faq.items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    );
  }

  return {
    language,
    title: text.title,
    description: text.description,
    indexable: path !== undefined,
    canonical,
    alternates:
      path === undefined
        ? []
        : [
            ...LANGUAGES.map((code) => ({
              hreflang: LANGUAGE_INFO[code].htmlLang,
              href: `${origin}${withLanguage(path, code)}`,
            })),
            { hreflang: "x-default", href: `${origin}${withLanguage(path, DEFAULT_LANGUAGE)}` },
          ],
    image: { url: `${origin}/og/og-${language}.png`, alt: t.meta.ogImageAlt },
    jsonLd,
  };
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** JSON for a script element: "<" written as an escape, so the data cannot close the element. */
function jsonForScript(value: unknown): string {
  const lessThan = `${String.fromCodePoint(92)}u003c`;
  return JSON.stringify(value).replaceAll("<", lessThan);
}

/** Every element is marked, so that the browser side can replace exactly this set. */
const MARK = 'data-head=""';

export function renderHead(head: PageHead): string {
  const meta = (attribute: "name" | "property", key: string, content: string) =>
    `<meta ${attribute}="${key}" content="${escapeHtml(content)}" ${MARK}>`;
  const lines = [
    `<title ${MARK}>${escapeHtml(head.title)}</title>`,
    meta("name", "description", head.description),
    meta("name", "robots", head.indexable ? "index,follow" : "noindex,follow"),
  ];
  if (head.canonical !== undefined) {
    lines.push(`<link rel="canonical" href="${escapeHtml(head.canonical)}" ${MARK}>`);
  }
  for (const alternate of head.alternates) {
    lines.push(
      `<link rel="alternate" hreflang="${escapeHtml(alternate.hreflang)}" href="${escapeHtml(alternate.href)}" ${MARK}>`,
    );
  }
  lines.push(
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", messagesFor(head.language).meta.siteName),
    meta("property", "og:title", head.title),
    meta("property", "og:description", head.description),
    meta("property", "og:locale", LANGUAGE_INFO[head.language].ogLocale),
    ...LANGUAGES.filter((code) => code !== head.language).map((code) =>
      meta("property", "og:locale:alternate", LANGUAGE_INFO[code].ogLocale),
    ),
    meta("property", "og:image", head.image.url),
    meta("property", "og:image:width", String(OG_IMAGE_SIZE.width)),
    meta("property", "og:image:height", String(OG_IMAGE_SIZE.height)),
    meta("property", "og:image:alt", head.image.alt),
    meta("name", "twitter:card", "summary_large_image"),
  );
  if (head.canonical !== undefined) {
    lines.push(meta("property", "og:url", head.canonical));
  }
  for (const data of head.jsonLd) {
    lines.push(`<script type="application/ld+json" ${MARK}>${jsonForScript(data)}</script>`);
  }
  return lines.join("\n    ");
}

/** After a navigation inside the app: make the document say what the new page is. */
export function applyHead(head: PageHead): void {
  document.documentElement.lang = LANGUAGE_INFO[head.language].htmlLang;
  for (const element of document.head.querySelectorAll("[data-head]")) {
    element.remove();
  }
  const template = document.createElement("template");
  // Markup we generated ourselves, with every value escaped by renderHead.
  template.innerHTML = renderHead(head);
  document.head.append(template.content);
}
