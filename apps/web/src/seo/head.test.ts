import type { RestMount, RestSkill } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../i18n/languages.js";
import { matchRoute } from "../router.js";
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
  },
  ref: null,
  pinned: false,
  commit: "a".repeat(40),
  path: "",
  verified: false,
  index: {
    status: "ready",
    truncated: false,
    skillCount: 2,
    documentCount: 1,
    skills: [
      { name: "review", directory: "review", description: "Reviews a change.", warnings: [] },
      { name: "release", directory: "release", description: "Writes notes.", warnings: [] },
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
    warnings: [],
  },
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
        "FAQPage",
      ]);
      expect(head.jsonLd.every((data) => data.inLanguage === language)).toBe(true);
    }
    expect(buildHead(matchRoute("/explore", ""), "en", ORIGIN).jsonLd).toEqual([]);
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
    expect(html.match(/application\/ld\+json/g)).toHaveLength(3);

    const hidden = renderHead(buildHead(matchRoute("/gh/acme/skills", ""), "en", ORIGIN));
    expect(hidden).toContain('<meta name="robots" content="noindex,follow"');
    expect(hidden).not.toContain("canonical");
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
