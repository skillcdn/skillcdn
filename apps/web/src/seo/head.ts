import {
  formatAddress,
  type RestLegalDocument,
  type RestMount,
  type RestOwner,
  type RestShowcase,
  type RestSkill,
  SOCIAL_ROUTE,
} from "@skillcdn/core";
import { docsPage, docsSectionLabel } from "../docs/catalog.js";
import { messagesFor } from "../i18n/index.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_INFO,
  LANGUAGE_PARAM,
  LANGUAGES,
  type Language,
  withLanguage,
} from "../i18n/languages.js";
import {
  repositoryDescription,
  repositoryName,
  skillDescription,
  skillTitle,
} from "../i18n/repository-text.js";
import { firstParagraph, legalTexts } from "../legal.js";
import { docsHref, mountHref, ownerHref, PATHS, type Route } from "../router.js";
import { showcaseEntries, showcaseTexts } from "../showcase.js";
import { LINKS } from "../site.js";

// What a crawler reads before it reads the page: title, description, which URL is canonical,
// where the other languages are, the social preview, and structured data. Built as data so it can
// be tested, rendered into prerendered pages, and applied in the browser after a navigation.

export interface PageHead {
  readonly language: Language;
  readonly title: string;
  readonly description: string;
  /** Whether search engines may index this URL. Pages without their data yet are not. */
  readonly indexable: boolean;
  /** Absolute URL of this page in this language. Only indexable pages have one. */
  readonly canonical: string | undefined;
  /** Every language of this page, plus `x-default`. Empty when the page is not indexable. */
  readonly alternates: readonly { readonly hreflang: string; readonly href: string }[];
  readonly image: { readonly url: string; readonly alt: string };
  readonly jsonLd: readonly Record<string, unknown>[];
}

/**
 * What a page knows about its data, once loaded: an address's, the front page's showcase, or the
 * document of a page of the deployment's own.
 */
export interface PageData {
  readonly mount?: RestMount | undefined;
  readonly skill?: RestSkill | undefined;
  readonly showcase?: RestShowcase | undefined;
  readonly legal?: RestLegalDocument | undefined;
  /** The account the page of an account is about. */
  readonly owner?: RestOwner["owner"] | undefined;
}

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** Search snippets are cut around here; the description says the most in its first words. */
const MAX_DESCRIPTION_LENGTH = 200;
/** How many skill names a repository's description lists. */
const NAMED_SKILLS = 8;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_DESCRIPTION_LENGTH
    ? flat
    : `${flat.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

/**
 * The path of a page that search engines may index, without a language, or `undefined`. Static
 * pages always are. The view of an address is when it is the living address (no ref, which would
 * be a snapshot of the same page) and its data was there to render: the overview or one skill.
 * The page of an account is once the account is known to have something public to show.
 */
function indexablePathOf(route: Route, data: PageData | undefined): string | undefined {
  switch (route.name) {
    case "landing":
      return PATHS.landing;
    case "explore":
      return PATHS.explore;
    case "legal":
      // Written into the deployment, the page is one to find; not written, there is none.
      return data?.legal === undefined ? undefined : PATHS[route.kind];
    case "docs":
      return docsHref(route.slug);
    case "mount": {
      const { address, view } = route;
      if (address.ref !== undefined || data?.mount?.index.status !== "ready") {
        return undefined;
      }
      // What only some people may see is nobody's to find.
      if (data.mount.repository.visibility === "private") {
        return undefined;
      }
      if (
        view.kind === "overview" &&
        view.query === undefined &&
        (view.path === undefined || view.path === address.path)
      ) {
        return mountHref(address, view);
      }
      if (view.kind === "skill" && data.skill?.status === "ready") {
        return mountHref(address, view);
      }
      return undefined;
    }
    case "owner":
      // What the git host lists for everyone is everyone's to find (ADR-0037). An account with
      // nothing public has a page with nothing on it, which is nothing to find.
      return data?.owner !== undefined && data.owner.publicRepositories > 0
        ? ownerHref(route.owner)
        : undefined;
    default:
      return undefined;
  }
}

function mountText(
  route: Extract<Route, { name: "mount" }>,
  language: Language,
  data: PageData | undefined,
): { readonly title: string; readonly description: string } {
  const t = messagesFor(language);
  const { address, view } = route;
  const mount = data?.mount;
  const manifest = (mount?.index.status === "ready" ? mount.index.manifest : null) ?? null;
  // A repository with a manifest goes by the name it gives itself, in this language when it can.
  const repository =
    (manifest === null ? null : repositoryName(manifest, language)) ??
    (mount === undefined
      ? `${address.owner}/${address.repo}`
      : `${mount.repository.owner}/${mount.repository.name}`);
  if (view.kind === "skill") {
    const skill = data?.skill?.status === "ready" ? data.skill.skill : undefined;
    return {
      title: t.meta.mount.skillTitle(
        skill === undefined ? view.path : skillTitle(skill, language),
        repository,
      ),
      description:
        skill === undefined
          ? t.meta.mount.description(repository)
          : clip(
              t.meta.mount.skillDescription(
                skillTitle(skill, language),
                repository,
                skillDescription(skill, language),
              ),
            ),
    };
  }
  if (view.kind === "file") {
    return {
      title: t.meta.mount.fileTitle(view.path, repository),
      description: t.meta.mount.description(repository),
    };
  }
  const index = mount?.index.status === "ready" ? mount.index : undefined;
  return {
    title: t.meta.mount.title(repository),
    description:
      index === undefined
        ? t.meta.mount.description(repository)
        : manifest !== null
          ? clip(repositoryDescription(manifest, language))
          : clip(
              t.meta.mount.summary(
                repository,
                index.skillCount,
                index.documentCount,
                index.skills.slice(0, NAMED_SKILLS).map((skill) => skill.name),
              ),
            ),
  };
}

function legalText(
  route: Extract<Route, { name: "legal" }>,
  language: Language,
  data: PageData | undefined,
): { readonly title: string; readonly description: string } {
  const t = messagesFor(language);
  const words = data?.legal === undefined ? undefined : legalTexts(data.legal, language);
  return {
    title: `${words?.title ?? t.footer[route.kind]} | ${t.meta.siteName}`,
    description: words === undefined ? "" : clip(firstParagraph(words.body)),
  };
}

function docsText(
  route: Extract<Route, { name: "docs" }>,
  language: Language,
): { readonly title: string; readonly description: string } {
  const t = messagesFor(language);
  if (route.slug === undefined) {
    return { title: t.docs.metaTitle, description: t.docs.metaDescription };
  }
  const page = docsPage(route.slug);
  return page === undefined
    ? t.meta.notFound
    : { title: t.docs.pageTitle(page.title), description: clip(page.description) };
}

export function buildHead(
  route: Route,
  language: Language,
  origin: string,
  data?: PageData,
): PageHead {
  const t = messagesFor(language);
  const path = indexablePathOf(route, data);
  const urlIn = (code: Language) =>
    path === undefined ? undefined : `${origin}${withLanguage(path, code)}`;
  // The documentation is written in English, whatever language the frame around it is shown
  // in: one URL is the page, in that language, and the others are not translations of it.
  const written: readonly Language[] = route.name === "docs" ? [DEFAULT_LANGUAGE] : LANGUAGES;
  const canonical = urlIn(route.name === "docs" ? DEFAULT_LANGUAGE : language);
  const inLanguage = LANGUAGE_INFO[language].htmlLang;

  const text =
    route.name === "landing"
      ? t.meta.landing
      : route.name === "explore"
        ? t.meta.explore
        : route.name === "mount"
          ? mountText(route, language, data)
          : route.name === "legal"
            ? legalText(route, language, data)
            : route.name === "docs"
              ? docsText(route, language)
              : route.name === "owner"
                ? {
                    // Named as the host spells it once that is known, as its path writes it before.
                    title: t.owner.metaTitle(data?.owner?.login ?? route.owner.owner),
                    description: t.owner.metaDescription(data?.owner?.login ?? route.owner.owner),
                  }
                : route.name === "account"
                  ? { title: t.account.metaTitle, description: "" }
                  : route.name === "consent"
                    ? { title: t.authorize.metaTitle, description: "" }
                    : route.name === "states" || route.name === "og-card"
                      ? { title: t.meta.siteName, description: "" }
                      : route.name === "bad-address"
                        ? { title: `${t.address.invalid} | ${t.meta.siteName}`, description: "" }
                        : t.meta.notFound;

  const jsonLd: Record<string, unknown>[] = [];
  // The front page shows the operator's showcase, else the build's own (ADR-0028).
  const showcase = route.name === "landing" ? showcaseEntries(data?.showcase) : [];
  if (route.name === "landing" && canonical !== undefined) {
    // The site as one entity, named the same everywhere, with its logo and its source.
    const publisher = {
      "@type": "Organization",
      name: t.meta.siteName,
      url: `${origin}${PATHS.landing}`,
      logo: `${origin}/brand/logo-black.png`,
      sameAs: [LINKS.repository],
    };
    jsonLd.push(
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: t.meta.siteName,
        url: canonical,
        description: t.meta.landing.description,
        inLanguage,
        publisher,
      },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: t.meta.siteName,
        url: canonical,
        description: t.meta.landing.about,
        applicationCategory: "ProductivityApplication",
        operatingSystem: "Any",
        license: LINKS.license,
        inLanguage,
        author: publisher,
      },
    );
    // The first clip of the showcase, described where it is served from.
    const lead = showcase.find((entry) => entry.media.clip !== null);
    if (lead?.media.clip) {
      const words = showcaseTexts(lead, language);
      jsonLd.push({
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: `${t.meta.siteName}: ${words.title}`,
        description: words.clip ?? words.title,
        thumbnailUrl: [`${origin}${lead.media.poster.url}`],
        contentUrl: `${origin}${lead.media.clip.url}`,
        ...(lead.published === null ? {} : { uploadDate: lead.published }),
        ...(lead.durationMs === null
          ? {}
          : { duration: `PT${Math.round(lead.durationMs / 1000)}S` }),
        inLanguage,
      });
    }
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage,
      mainEntity: t.landing.faq.items.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  if (route.name === "docs" && canonical !== undefined) {
    // A page of the documentation is an article of the site, found by its breadcrumbs: the
    // documentation, its section, the page. The index is the collection of them.
    const page = route.slug === undefined ? undefined : docsPage(route.slug);
    const site = { "@type": "WebSite", name: t.meta.siteName, url: `${origin}${PATHS.landing}` };
    const docsLanguage = LANGUAGE_INFO[DEFAULT_LANGUAGE].htmlLang;
    jsonLd.push(
      page === undefined
        ? {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: t.docs.title,
            description: t.docs.metaDescription,
            url: canonical,
            inLanguage: docsLanguage,
            isPartOf: site,
          }
        : {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: page.title,
            description: page.description,
            url: canonical,
            mainEntityOfPage: canonical,
            inLanguage: docsLanguage,
            isPartOf: site,
            publisher: {
              "@type": "Organization",
              name: t.meta.siteName,
              url: `${origin}${PATHS.landing}`,
              logo: `${origin}/brand/logo-black.png`,
            },
          },
    );
    const crumbs = [
      { name: t.docs.title, item: `${origin}${PATHS.docs}` },
      ...(page === undefined
        ? []
        : [{ name: docsSectionLabel(t, page.section) }, { name: page.title, item: canonical }]),
    ];
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        ...("item" in crumb ? { item: crumb.item } : {}),
      })),
    });
  }

  // A showcase entry may bring its own picture for link previews; the build's card otherwise.
  const social = showcase[0]?.media.social ?? null;
  // The page of an address unfurls with a card the server draws for it, in this language, with
  // the skill's words when the page shows one (ADR-0032); the language is in the URL so that a
  // crawler gets the card of the page it read, whatever language it asks for itself. A private
  // repository has none: a card is drawn for whoever a link is sent to, and to them the
  // repository does not exist.
  // A page of the documentation unfurls with a card drawn the same way, under its own path.
  const drawn =
    route.name === "mount" &&
    data?.mount !== undefined &&
    data.mount.repository.visibility !== "private"
      ? `${origin}${SOCIAL_ROUTE}${formatAddress(route.address)}?${LANGUAGE_PARAM}=${language}${
          route.view.kind === "skill" ? `&skill=${encodeURIComponent(route.view.path)}` : ""
        }`
      : route.name === "docs" && canonical !== undefined
        ? `${origin}${SOCIAL_ROUTE}${docsHref(route.slug)}?${LANGUAGE_PARAM}=${language}`
        : undefined;
  if (route.name === "mount" && canonical !== undefined && data?.mount !== undefined) {
    const { repository } = data.mount;
    const manifest = data.mount.index.status === "ready" ? data.mount.index.manifest : null;
    const named =
      (manifest === null ? null : repositoryName(manifest, language)) ??
      `${repository.owner}/${repository.name}`;
    const skill =
      route.view.kind === "skill" && data.skill?.status === "ready" ? data.skill.skill : undefined;
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": skill === undefined ? "SoftwareSourceCode" : "TechArticle",
      name: skill === undefined ? named : skillTitle(skill, language),
      url: canonical,
      description: text.description,
      inLanguage,
      ...(skill === undefined
        ? { codeRepository: `https://github.com/${repository.owner}/${repository.name}` }
        : {
            isPartOf: {
              "@type": "SoftwareSourceCode",
              name: named,
            },
          }),
    });
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
            ...written.map((code) => ({
              hreflang: LANGUAGE_INFO[code].htmlLang,
              href: `${origin}${withLanguage(path, code)}`,
            })),
            { hreflang: "x-default", href: `${origin}${withLanguage(path, DEFAULT_LANGUAGE)}` },
          ],
    image:
      drawn === undefined
        ? {
            url: social === null ? `${origin}/og/og-${language}.png` : `${origin}${social.url}`,
            alt: t.meta.ogImageAlt,
          }
        : { url: drawn, alt: text.title },
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
