import type {
  RestLegalDocument,
  RestMount,
  RestOwner,
  RestShowcase,
  RestSkill,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/index.js";
import { LANGUAGES } from "../i18n/languages.js";
import { matchRoute } from "../router.js";
import { DEFAULT_SHOWCASE_MEDIA } from "../site.js";
import { buildHead, renderHead } from "./head.js";

const ORIGIN = "https://skills.example";

const MOUNT: RestMount = {
  address: "/gh/acme/skills",
  repository: {
    host: "gh",
    owner: "Acme",
    name: "skills",
    defaultBranch: "main",
    description: null,
    avatar: "https://avatars.example/acme.png",
  },
  ref: null,
  pinned: false,
  commit: "a".repeat(40),
  path: "",
  verified: false,
  image: null,
  index: {
    status: "ready",
    truncated: false,
    manifest: null,
    skillCount: 2,
    documentCount: 1,
    skills: [
      {
        name: "review",
        directory: "review",
        description: "Reviews a change.",
        warnings: [],
        translations: {},
      },
      {
        name: "release",
        directory: "release",
        description: "Writes notes.",
        warnings: [],
        translations: {},
      },
    ],
    documents: [{ path: "README.md", title: "Skills", summary: null }],
    diagnostics: [],
  },
};

const SKILL: RestSkill = {
  status: "ready",
  skill: {
    name: "review",
    directory: "review",
    description: "Reviews a change for the things a linter cannot see.",
    license: null,
    compatibility: null,
    allowedTools: null,
    metadata: {},
    body: "# Review",
    files: [],
    filesTruncated: false,
    included: [],
    warnings: [],
    rules: null,
    translations: {
      ko: { title: "리뷰", description: "린터가 보지 못하는 것을 살펴 변경을 검토합니다." },
    },
  },
};

const OWNER: RestOwner["owner"] = {
  host: "gh",
  login: "Acme",
  name: "Acme, Inc.",
  kind: "organization",
  avatar: "https://avatars.example/acme.png",
  bio: null,
  url: "https://github.com/Acme",
  publicRepositories: 3,
};

describe("buildHead", () => {
  it("gives an indexable page one canonical URL per language, and tells each about the others", () => {
    const english = buildHead(matchRoute("/", ""), "en", ORIGIN);
    const korean = buildHead(matchRoute("/", "?lang=ko"), "ko", ORIGIN);

    expect(english.canonical).toBe("https://skills.example/");
    expect(korean.canonical).toBe("https://skills.example/?lang=ko");
    expect(english.indexable && korean.indexable).toBe(true);
    // The same set on every variant, itself included, plus the fallback for other readers.
    const alternates = [
      { hreflang: "en", href: "https://skills.example/" },
      { hreflang: "ko", href: "https://skills.example/?lang=ko" },
      { hreflang: "x-default", href: "https://skills.example/" },
    ];
    expect(english.alternates).toEqual(alternates);
    expect(korean.alternates).toEqual(alternates);
    expect(korean.title).not.toBe(english.title);
    expect(korean.image.url).toBe("https://skills.example/og/og-ko.png");
    expect(buildHead(matchRoute("/explore", ""), "ko", ORIGIN).canonical).toBe(
      "https://skills.example/explore?lang=ko",
    );
  });

  it("describes the product as structured data on the front page, in the page's language", () => {
    for (const language of LANGUAGES) {
      const head = buildHead(matchRoute("/", ""), language, ORIGIN);
      expect(head.jsonLd.map((data) => data["@type"])).toEqual([
        "WebSite",
        "SoftwareApplication",
        "VideoObject",
        "FAQPage",
      ]);
      expect(head.jsonLd.every((data) => data.inLanguage === language)).toBe(true);
      // The site is one entity with a logo, and the clip is described where it is served from.
      expect(head.jsonLd[0]?.publisher).toMatchObject({
        "@type": "Organization",
        name: "SkillCDN",
        logo: `${ORIGIN}/brand/logo-black.png`,
      });
      expect(head.jsonLd[2]).toMatchObject({
        contentUrl: `${ORIGIN}${DEFAULT_SHOWCASE_MEDIA.clip}`,
        thumbnailUrl: [`${ORIGIN}${DEFAULT_SHOWCASE_MEDIA.poster}`],
        uploadDate: DEFAULT_SHOWCASE_MEDIA.published,
      });
    }
    expect(buildHead(matchRoute("/explore", ""), "en", ORIGIN).jsonLd).toEqual([]);
  });

  it("describes the operator's showcase instead, and previews it with the entry's own picture", () => {
    const entry: RestShowcase["items"][number] = {
      id: "poster-only",
      address: "/gh/acme/skills@main/skills",
      position: 0,
      width: 640,
      height: 480,
      durationMs: null,
      published: null,
      media: {
        clip: null,
        animation: null,
        poster: { url: "/media/poster", type: "image/webp" },
        reference: null,
        picture: null,
        social: { url: "/media/social", type: "image/png" },
      },
      texts: {
        en: {
          title: "A poster",
          body: "Only a picture.",
          tags: [],
          action: "Open",
          requirement: null,
          clip: null,
          credit: null,
          demo: null,
        },
      },
    };
    // Without a clip there is no video to describe; the preview picture is the entry's.
    const still = buildHead(matchRoute("/", ""), "ko", ORIGIN, { showcase: { items: [entry] } });
    expect(still.jsonLd.map((data) => data["@type"])).toEqual([
      "WebSite",
      "SoftwareApplication",
      "FAQPage",
    ]);
    expect(still.image.url).toBe(`${ORIGIN}/media/social`);
    const withClip = buildHead(matchRoute("/", ""), "en", ORIGIN, {
      showcase: {
        items: [
          {
            ...entry,
            durationMs: 12_400,
            published: "2026-10-01",
            media: { ...entry.media, clip: { url: "/media/clip", type: "video/mp4" } },
          },
        ],
      },
    });
    expect(withClip.jsonLd[2]).toMatchObject({
      "@type": "VideoObject",
      name: "SkillCDN: A poster",
      description: "A poster",
      contentUrl: `${ORIGIN}/media/clip`,
      thumbnailUrl: [`${ORIGIN}/media/poster`],
      uploadDate: "2026-10-01",
      duration: "PT12S",
    });
    // An empty showcase is the build's own.
    expect(
      buildHead(matchRoute("/", ""), "en", ORIGIN, { showcase: { items: [] } }).image.url,
    ).toBe(`${ORIGIN}/og/og-en.png`);
  });

  it("offers the documentation to search engines as pages in English, each with a card drawn for it", () => {
    // The frame is in the visitor's language, the page is not: one URL, no translations of it.
    const index = buildHead(matchRoute("/docs", "?lang=ko"), "ko", ORIGIN);
    expect(index.indexable).toBe(true);
    expect(index.canonical).toBe("https://skills.example/docs");
    expect(index.alternates).toEqual([
      { hreflang: "en", href: "https://skills.example/docs" },
      { hreflang: "x-default", href: "https://skills.example/docs" },
    ]);
    expect(index.title).toBe(messagesFor("ko").docs.metaTitle);
    expect(index.image.url).toBe("https://skills.example/social/docs?lang=ko");
    expect(index.jsonLd.map((data) => data["@type"])).toEqual(["CollectionPage", "BreadcrumbList"]);

    const page = buildHead(matchRoute("/docs/format", ""), "en", ORIGIN);
    expect(page.indexable).toBe(true);
    expect(page.canonical).toBe("https://skills.example/docs/format");
    expect(page.title).toBe("The SkillCDN Format · Docs | SkillCDN");
    expect(page.description.length).toBeGreaterThan(20);
    expect(page.image.url).toBe("https://skills.example/social/docs/format?lang=en");
    expect(page.image.alt).toBe(page.title);
    expect(page.jsonLd[0]).toMatchObject({
      "@type": "TechArticle",
      headline: "The SkillCDN Format",
      inLanguage: "en",
      url: "https://skills.example/docs/format",
    });
    const crumbs = page.jsonLd[1] as {
      readonly "@type": string;
      readonly itemListElement: readonly { name: string }[];
    };
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement.map((item) => item.name)).toEqual([
      "Documentation",
      "Reference",
      "The SkillCDN Format",
    ]);
    expect(renderHead(page)).toContain('<meta name="robots" content="index,follow"');
  });

  it("keeps pages of an address out of search indexes until their data is there", () => {
    for (const path of ["/gh/acme/skills", "/gh/acme/skills.git", "/nothing-here"]) {
      const head = buildHead(matchRoute(path, ""), "en", ORIGIN);
      expect(head.indexable, path).toBe(false);
      expect(head.canonical, path).toBeUndefined();
      expect(head.alternates, path).toEqual([]);
    }
    expect(buildHead(matchRoute("/gh/acme/skills", ""), "ko", ORIGIN).title).toContain(
      "acme/skills",
    );
    const indexing = buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN, {
      mount: { ...MOUNT, index: { status: "indexing" } },
    });
    expect(indexing.indexable).toBe(false);
  });

  it("keeps what is one person's out of search indexes", () => {
    const mount: RestMount = {
      ...MOUNT,
      repository: { ...MOUNT.repository, visibility: "private" },
    };
    const head = buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN, { mount });
    expect(head.indexable).toBe(false);
    expect(head.canonical).toBeUndefined();
    expect(head.jsonLd).toEqual([]);
    // No card either: one is drawn for whoever a link is sent to, and they are not let in.
    expect(head.image.url).toBe(`${ORIGIN}/og/og-en.png`);
    expect(
      buildHead(matchRoute("/gh/acme/skills", "?skill=review"), "en", ORIGIN, {
        mount,
        skill: SKILL,
      }).indexable,
    ).toBe(false);

    for (const path of ["/account", "/account/apps", "/oauth/consent"]) {
      for (const language of LANGUAGES) {
        const page = buildHead(matchRoute(path, ""), language, ORIGIN);
        expect(page.indexable, path).toBe(false);
        expect(page.canonical, path).toBeUndefined();
        expect(page.alternates, path).toEqual([]);
        expect(page.title, path).toContain("SkillCDN");
        expect(renderHead(page), path).toContain('<meta name="robots" content="noindex,follow"');
      }
    }
  });

  it("offers the page of an account to search engines once it has something public to show", () => {
    // Before the page knows the account it is named as its path writes it, and is not one to find.
    const unknown = buildHead(matchRoute("/gh/Acme", ""), "en", ORIGIN);
    expect(unknown.title).toBe("acme | SkillCDN");
    expect(unknown.indexable).toBe(false);
    expect(unknown.canonical).toBeUndefined();
    expect(unknown.alternates).toEqual([]);
    expect(renderHead(unknown)).toContain('<meta name="robots" content="noindex,follow"');

    // Known, it is named as the host spells it, at one URL per language however it was typed.
    const known = buildHead(matchRoute("/gh/Acme", ""), "ko", ORIGIN, { owner: OWNER });
    expect(known.title).toBe("Acme | SkillCDN");
    expect(known.description).toContain("Acme");
    expect(known.indexable).toBe(true);
    expect(known.canonical).toBe("https://skills.example/gh/acme?lang=ko");
    expect(known.alternates).toEqual([
      { hreflang: "en", href: "https://skills.example/gh/acme" },
      { hreflang: "ko", href: "https://skills.example/gh/acme?lang=ko" },
      { hreflang: "x-default", href: "https://skills.example/gh/acme" },
    ]);
    expect(renderHead(known)).toContain('<meta name="robots" content="index,follow"');

    // An account with nothing public has a page with nothing on it.
    const empty = buildHead(matchRoute("/gh/acme", ""), "en", ORIGIN, {
      owner: { ...OWNER, publicRepositories: 0 },
    });
    expect(empty.indexable).toBe(false);
    expect(empty.canonical).toBeUndefined();
  });

  it("names a repository as its manifest does, and describes it in its own words", () => {
    if (MOUNT.index.status !== "ready") {
      throw new Error("expected a ready fixture");
    }
    const mount = {
      ...MOUNT,
      index: {
        ...MOUNT.index,
        manifest: {
          path: "SKILLCDN.md",
          name: "Acme playbooks",
          description: "What Acme runs.",
          language: "en",
          translations: { ko: { name: "Acme 플레이북", description: "Acme가 하는 일." } },
        },
      },
    };
    const overview = buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN, { mount });
    expect(overview.title).toBe("Acme playbooks | SkillCDN");
    expect(overview.description).toBe("What Acme runs.");
    expect(overview.jsonLd[0]?.name).toBe("Acme playbooks");
    const skill = buildHead(matchRoute("/gh/acme/skills", "?skill=review"), "en", ORIGIN, {
      mount,
      skill: SKILL,
    });
    expect(skill.title).toBe("review · Acme playbooks | SkillCDN");

    // In a language the author translated into, the page speaks that language.
    const korean = buildHead(matchRoute("/gh/acme/skills", "?lang=ko"), "ko", ORIGIN, { mount });
    expect(korean.title).toBe("Acme 플레이북 | SkillCDN");
    expect(korean.description).toBe("Acme가 하는 일.");
    const koreanSkill = buildHead(
      matchRoute("/gh/acme/skills", "?skill=review&lang=ko"),
      "ko",
      ORIGIN,
      {
        mount,
        skill: SKILL,
      },
    );
    expect(koreanSkill.title).toBe("리뷰 · Acme 플레이북 | SkillCDN");
    expect(koreanSkill.description).toContain("린터가 보지 못하는 것을");
    expect(koreanSkill.jsonLd[0]?.name).toBe("리뷰");
  });

  it("describes a repository and a skill from their data, per language, with one canonical URL", () => {
    const overview = buildHead(matchRoute("/gh/acme/skills", "?lang=ko"), "ko", ORIGIN, {
      mount: MOUNT,
    });
    expect(overview.indexable).toBe(true);
    expect(overview.canonical).toBe("https://skills.example/gh/acme/skills?lang=ko");
    expect(overview.alternates).toEqual([
      { hreflang: "en", href: "https://skills.example/gh/acme/skills" },
      { hreflang: "ko", href: "https://skills.example/gh/acme/skills?lang=ko" },
      { hreflang: "x-default", href: "https://skills.example/gh/acme/skills" },
    ]);
    expect(overview.title).toContain("Acme/skills");
    expect(overview.description).toContain("review, release");
    expect(overview.jsonLd.map((data) => data["@type"])).toEqual(["SoftwareSourceCode"]);

    const skill = buildHead(matchRoute("/gh/acme/skills", "?skill=review"), "en", ORIGIN, {
      mount: MOUNT,
      skill: SKILL,
    });
    expect(skill.indexable).toBe(true);
    expect(skill.canonical).toBe("https://skills.example/gh/acme/skills?skill=review");
    expect(skill.alternates[1]).toEqual({
      hreflang: "ko",
      href: "https://skills.example/gh/acme/skills?skill=review&lang=ko",
    });
    expect(skill.title).toBe("review · Acme/skills | SkillCDN");
    expect(skill.description).toContain("Reviews a change for the things a linter cannot see.");
    expect(skill.jsonLd.map((data) => data["@type"])).toEqual(["TechArticle"]);
    // A skill the address does not have is no page to index.
    expect(
      buildHead(matchRoute("/gh/acme/skills", "?skill=other"), "en", ORIGIN, { mount: MOUNT })
        .indexable,
    ).toBe(false);
  });

  it("leaves snapshots, files and searches to the living page", () => {
    const pinned = buildHead(matchRoute("/gh/acme/skills@v1", ""), "en", ORIGIN, {
      mount: { ...MOUNT, ref: "v1" },
    });
    expect(pinned.indexable).toBe(false);
    expect(pinned.title).toContain("Acme/skills");
    for (const search of ["?file=README.md", "?q=review"]) {
      const head = buildHead(matchRoute("/gh/acme/skills", search), "en", ORIGIN, {
        mount: MOUNT,
      });
      expect(head.indexable, search).toBe(false);
      expect(head.canonical, search).toBeUndefined();
    }
    expect(
      buildHead(matchRoute("/gh/acme/skills", "?file=README.md"), "en", ORIGIN, { mount: MOUNT })
        .title,
    ).toBe("README.md · Acme/skills | SkillCDN");
  });
});

describe("the picture of the page of an address", () => {
  it("is the card the server draws for it, in the page's language, and the skill's for a skill", () => {
    const repository = buildHead(matchRoute("/gh/acme/skills", "?lang=ko"), "ko", ORIGIN, {
      mount: MOUNT,
    });
    expect(repository.image.url).toBe(`${ORIGIN}/social/gh/acme/skills?lang=ko`);
    expect(repository.image.alt).toBe(repository.title);
    const skill = buildHead(
      matchRoute("/gh/acme/skills", "?skill=review%2FSKILL.md"),
      "en",
      ORIGIN,
      { mount: MOUNT },
    );
    expect(skill.image.url).toBe(`${ORIGIN}/social/gh/acme/skills?lang=en&skill=review%2FSKILL.md`);
    // Without the address's data there is no card to name: the site's own picture stands.
    expect(buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN).image.url).toBe(
      `${ORIGIN}/og/og-en.png`,
    );
  });
});

describe("renderHead", () => {
  it("writes what crawlers and link previews read", () => {
    const html = renderHead(buildHead(matchRoute("/", "?lang=ko"), "ko", ORIGIN));
    expect(html).toContain('<link rel="canonical" href="https://skills.example/?lang=ko"');
    expect(html).toContain('hreflang="x-default" href="https://skills.example/"');
    expect(html).toContain('<meta name="robots" content="index,follow"');
    expect(html).toContain('<meta property="og:locale" content="ko_KR"');
    expect(html).toContain('<meta property="og:locale:alternate" content="en_US"');
    expect(html).toContain(
      '<meta property="og:image" content="https://skills.example/og/og-ko.png"',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html.match(/application\/ld\+json/g)).toHaveLength(4);

    const hidden = renderHead(buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN));
    expect(hidden).toContain('<meta name="robots" content="noindex,follow"');
    expect(hidden).not.toContain("canonical");
  });

  it("names a page of the deployment's own after its document, and hides one not written", () => {
    const document: RestLegalDocument = {
      kind: "privacy",
      revised: null,
      texts: { en: { title: "Privacy policy", body: "We keep **little**.\n\nDetails follow." } },
    };
    const written = buildHead(matchRoute("/privacy", ""), "ko", ORIGIN, { legal: document });
    expect(written).toMatchObject({
      indexable: true,
      canonical: "https://skills.example/privacy?lang=ko",
      title: "Privacy policy | SkillCDN",
      description: "We keep little.",
    });
    expect(written.alternates.map((alternate) => alternate.hreflang)).toEqual([
      "en",
      "ko",
      "x-default",
    ]);
    const unwritten = buildHead(matchRoute("/terms", ""), "en", ORIGIN);
    expect(unwritten).toMatchObject({
      indexable: false,
      canonical: undefined,
      title: "Terms | SkillCDN",
      description: "",
    });
  });

  it("escapes what comes from a URL", () => {
    // Owner and repository names cannot carry markup, but a head is no place to rely on that.
    const head = buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN);
    const html = renderHead({
      ...head,
      title: '</title><script>alert("x")</script>',
      jsonLd: [{ name: "</script><script>alert(1)</script>" }],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;/title&gt;");
    expect(html).not.toMatch(/<\/script><script>/);
  });
});
