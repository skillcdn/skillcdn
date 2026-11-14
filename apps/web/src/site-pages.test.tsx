import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { site as example } from "../examples/site/site.config.js";
import { pageOfRoute } from "./analytics.js";
import { App } from "./app.js";
import { renderSitePage, SITE_ROUTES, TEMPLATE_MARKERS } from "./entry-server.js";
import { matchRoute } from "./router.js";
import { buildHead } from "./seo/head.js";
import { SITE_PAGES } from "./site-config.js";
import { defineSite, sitePageAt, sitePageHref, sitePageLabel } from "./site-pages.js";

// Pages of an installation's own (ADR-0099): what a configuration is, where its pages live, and
// what the pages of the product do with them. The configuration of the example is what an
// installation writes; the build of the tests has none, as the image's has none.

const PAGES = example.pages ?? [];
const TEMPLATE = `<!doctype html>\n${TEMPLATE_MARKERS.htmlLang}<head>${TEMPLATE_MARKERS.head}</head><body>${TEMPLATE_MARKERS.root}</body></html>`;

const rendered = (pathname: string, language?: "en" | "ko", site = example): string =>
  renderToString(
    <App
      initialLocation={{ pathname, search: "" }}
      origin="https://packs.example"
      site={site}
      {...(language === undefined ? {} : { preferredLanguage: language })}
    />,
  );

describe("a configuration", () => {
  it("names its pages by keys the address takes, each once, each with a word", () => {
    const page = { label: "Status", render: () => null };
    expect(defineSite({ pages: [{ ...page, key: "status" }] }).pages).toHaveLength(1);
    expect(defineSite({}).pages).toBeUndefined();
    for (const key of ["", "Status", "a b", "-a", "a-", "a/b", "../x", "a".repeat(65)]) {
      expect(() => defineSite({ pages: [{ ...page, key }] })).toThrow("lowercase letters");
    }
    expect(() =>
      defineSite({
        pages: [
          { ...page, key: "status" },
          { ...page, key: "status" },
        ],
      }),
    ).toThrow("two pages have the key status");
    expect(() => defineSite({ pages: [{ ...page, key: "status", label: " " }] })).toThrow(
      "the page status has no label",
    );
  });

  it("calls a page by its word in the language asked for, English standing in", () => {
    const [packs] = PAGES;
    if (packs === undefined) throw new Error("the example has a page");
    expect(sitePageLabel(packs, "en")).toBe("Packs");
    expect(sitePageLabel(packs, "ko")).toBe("팩");
    expect(sitePageLabel(packs, "ja")).toBe("Packs");
    expect(sitePageLabel({ ...packs, label: "Status" }, "ko")).toBe("Status");
    expect(sitePageHref("packs")).toBe("/pages/packs");
    expect(sitePageAt(PAGES, "/pages/packs")?.key).toBe("packs");
    expect(sitePageAt(PAGES, "/pages/packs/more")).toBeUndefined();
    expect(sitePageAt(PAGES, "/pages")).toBeUndefined();
  });
});

describe("the pages of the product with a page of an installation's own", () => {
  it("routes its address to it, and no other", () => {
    expect(matchRoute("/pages/packs", "", false, PAGES)).toEqual({ name: "site", key: "packs" });
    expect(matchRoute("/pages/packs", "?lang=ko", false, PAGES)).toEqual({
      name: "site",
      key: "packs",
    });
    expect(matchRoute("/pages/other", "", false, PAGES)).toEqual({ name: "not-found" });
    expect(matchRoute("/pages/packs/x", "", false, PAGES)).toEqual({ name: "not-found" });
    // The build of the product has no such pages: the address is nothing there.
    expect(SITE_PAGES).toEqual([]);
    expect(SITE_ROUTES).toEqual([]);
    expect(matchRoute("/pages/packs", "")).toEqual({ name: "not-found" });
  });

  it("names it in the header's menu where it asks, in the visitor's language", () => {
    expect(rendered("/")).toMatch(/<a href="\/pages\/packs"[^>]*>Packs<\/a>/);
    expect(rendered("/", "ko")).toMatch(/<a href="\/pages\/packs"[^>]*>팩<\/a>/);
    // A page that does not ask is reached by its address alone, and the product's own build
    // names none.
    const quiet = defineSite({ pages: PAGES.map((page) => ({ ...page, menu: false })) });
    expect(rendered("/", "en", quiet)).not.toContain("/pages/packs");
    expect(rendered("/", "en", defineSite({}))).not.toContain("/pages/");
  });

  it("draws nothing of it where the pages are rendered to HTML", () => {
    // Its address renders the frame and a placeholder; the page draws itself in the browser.
    const html = rendered("/pages/packs");
    expect(html).toContain('href="/pages/packs"');
    expect(html).not.toContain("Packs of this installation");
    expect(html).toContain('role="status"');
  });

  it("is titled by its word and is never a page to find or to count", () => {
    const head = buildHead(
      { name: "site", key: "packs" },
      "ko",
      "https://packs.example",
      undefined,
      PAGES,
    );
    expect(head.title).toBe("팩 | SkillCDN");
    expect(head.indexable).toBe(false);
    expect(head.canonical).toBeUndefined();
    expect(pageOfRoute({ name: "site", key: "packs" })).toBeUndefined();
  });

  it("is answered as nothing by a build that has no such page", () => {
    const page = renderSitePage(TEMPLATE, {
      language: "en",
      origin: "https://packs.example",
      pathname: "/pages/packs",
      search: "",
    });
    expect(page.indexable).toBe(false);
    expect(page.html).toContain('data-prerendered="not-found"');
  });
});
