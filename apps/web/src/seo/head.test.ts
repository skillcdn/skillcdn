import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../i18n/languages.js";
import { matchRoute } from "../router.js";
import { buildHead, renderHead } from "./head.js";

const ORIGIN = "https://skills.example";

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

  it("keeps pages that depend on a repository out of search indexes", () => {
    for (const path of ["/gh/acme/skills", "/gh/acme/skills.git", "/nothing-here"]) {
      const head = buildHead(matchRoute(path, ""), "en", ORIGIN);
      expect(head.indexable, path).toBe(false);
      expect(head.canonical, path).toBeUndefined();
      expect(head.alternates, path).toEqual([]);
    }
    expect(buildHead(matchRoute("/gh/acme/skills", ""), "ko", ORIGIN).title).toContain(
      "acme/skills",
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
