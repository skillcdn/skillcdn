import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebBuild, WEB_BUILD_MANIFEST, type WebBuildFixture } from "../testing/web-build.js";
import {
  loadWebBundle,
  negotiateLanguage,
  type WebBundle,
  WebBundleError,
  type WebRequest,
  wantsHtml,
} from "./web.js";

const request = (
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    origin?: string;
    country?: string;
  } = {},
): WebRequest => ({
  method: init.method ?? "GET",
  url: new URL(path, init.origin ?? "http://internal.test:8080"),
  headers: new Headers(init.headers),
  country: init.country,
});

let build: WebBuildFixture;
let web: WebBundle;

beforeAll(async () => {
  build = createWebBuild();
  web = await loadWebBundle(build.root, { publicUrl: "https://skills.example" });
});

afterAll(() => build.remove());

const answer = (path: string, init?: Parameters<typeof request>[1]): Response => {
  const response = web.respond(request(path, init));
  if (response === undefined) {
    throw new Error(`nothing answered ${path}`);
  }
  return response;
};

describe("pages", () => {
  it("are chosen by the language parameter, else by what the request asks for, else the default", async () => {
    // The parameter decides, whatever the request asks for, and nothing about the answer varies.
    const forced = answer("/?lang=en", { headers: { "accept-language": "ko-KR" } });
    expect(forced.headers.get("content-language")).toBe("en");
    expect(forced.headers.get("vary")).toBeNull();
    expect(await forced.text()).toContain('<html lang="en">');
    const korean = answer("/?lang=ko");
    expect(korean.headers.get("content-language")).toBe("ko");
    expect(await korean.text()).toContain("Front page in Korean");
    expect(await answer("/explore?lang=ko&utm=x").text()).toContain("Explore in Korean");

    // Without one, what the request asks for decides, and the answer says it depends on that:
    // a link preview is in the language of the app that asks for it (ADR-0021).
    const asked = answer("/", { headers: { "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8" } });
    expect(asked.headers.get("content-language")).toBe("ko");
    expect(asked.headers.get("vary")).toBe("accept-language");
    expect(await asked.text()).toContain("Front page in Korean");
    const second = answer("/explore", {
      headers: { "accept-language": "fr-FR, ko;q=0.5, en;q=0.4" },
    });
    expect(await second.text()).toContain("Explore in Korean");
    // Nothing asked for, or nothing the build has: the default, still saying it varies.
    const plain = answer("/");
    expect(plain.headers.get("content-language")).toBe("en");
    expect(plain.headers.get("vary")).toBe("accept-language");
    expect(await answer("/", { headers: { "accept-language": "fr, de" } }).text()).toContain(
      '<html lang="en">',
    );
    // A parameter naming a language the build does not have forces nothing.
    expect(await answer("/?lang=fr", { headers: { "accept-language": "ko" } }).text()).toContain(
      "Front page in Korean",
    );
    expect(await answer("/?lang=KO").text()).toContain('<html lang="en">');
    // A file in one language only answers in that one, whatever is asked for.
    const llms = answer("/llms.txt", { headers: { "accept-language": "ko" } });
    expect(llms.headers.get("content-language")).toBe("en");
    expect(llms.headers.get("vary")).toBe("accept-language");
  });

  it("carry the public origin in place of the placeholder", async () => {
    const html = await answer("/").text();
    expect(html).toContain('href="https://skills.example/"');
    expect(html).toContain("<code>skills.example/gh/owner/repo</code>");
    expect(html).not.toContain("placeholder");
    expect(await answer("/llms.txt").text()).toContain("https://skills.example/gh/owner/repo");
  });

  it("fall back to the origin of the request when none is configured", async () => {
    const unconfigured = await loadWebBundle(build.root, { publicUrl: undefined });
    const response = unconfigured.respond(request("/", { origin: "http://localhost:8080" }));
    expect(await response?.text()).toContain('href="http://localhost:8080/"');
  });

  it("forbid inline scripts, foreign sources and framing", () => {
    const headers = answer("/").headers;
    const policy = headers.get("content-security-policy") ?? "";
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(answer("/llms.txt").headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(answer("/llms.txt").headers.get("content-security-policy")).toBeNull();
  });

  it("may be cached, but must be revalidated, and revalidate cheaply", async () => {
    const first = answer("/");
    expect(first.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^W\/"/);
    const second = answer("/", { headers: { "if-none-match": `"other", ${etag}` } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(answer("/?lang=ko").headers.get("etag")).not.toBe(etag);

    const head = answer("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("include the page for what is missing", async () => {
    const missing = web.notFound(request("/nothing"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Not found");
  });
});

describe("the page of an address", () => {
  const mount = { address: "/gh/acme/skills", index: { status: "ready" } };

  it("is rendered by the build's module with what the server knows, in the language asked", async () => {
    const page = web.address(request("/gh/acme/skills?skill=review&lang=ko"), {
      mount: { ready: mount },
      skill: { error: { status: 404, code: "skill.not_found", message: "No such skill." } },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-language")).toBe("ko");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    // The same URL answers MCP clients with something else entirely.
    expect(page.headers.get("vary")).toBe("accept");
    const html = await page.text();
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain("<title>Rendered /gh/acme/skills</title>");
    const input = JSON.parse(/<pre id="input">(.*?)<\/pre>/s.exec(html)?.[1] ?? "{}");
    expect(input).toEqual({
      language: "ko",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?skill=review&lang=ko",
      features: {},
      data: {
        mount: { ready: mount },
        skill: { error: { status: 404, code: "skill.not_found", message: "No such skill." } },
      },
    });
    // The template's placeholder is filled in like everywhere else.
    expect(html).toContain('<meta name="skillcdn-origin" content="https://skills.example">');
  });

  it("is rendered in the language the request asks for when the URL names none", async () => {
    const page = web.address(
      request("/gh/acme/skills", { headers: { "accept-language": "ko-KR,ko;q=0.9" } }),
      { mount: { ready: mount } },
    );
    expect(page.headers.get("content-language")).toBe("ko");
    expect(page.headers.get("vary")).toBe("accept, accept-language");
    const html = await page.text();
    expect(html).toContain('<html lang="ko">');
    const input = JSON.parse(/<pre id="input">(.*?)<\/pre>/s.exec(html)?.[1] ?? "{}");
    expect(input).toMatchObject({ language: "ko", search: "" });
  });

  it("carries the status the server gives it, and nothing when there is nothing to know", async () => {
    const missing = web.address(
      request("/gh/acme/none"),
      { mount: { error: { status: 404, code: "mount.repo_not_found", message: "Nothing." } } },
      404,
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("mount.repo_not_found");
    const bad = web.address(request("/gh/acme"), {}, 404);
    expect(bad.status).toBe(404);
    expect(await bad.text()).toContain('"data":{}');
  });

  it("is the frame for the browser to fill when the build cannot render", async () => {
    const plain = createWebBuild(WEB_BUILD_MANIFEST, { render: false });
    const bundle = await loadWebBundle(plain.root, { publicUrl: "https://skills.example" });
    const shell = bundle.address(request("/gh/acme/skills?lang=ko"), { mount: { ready: mount } });
    expect(shell.status).toBe(200);
    expect(shell.headers.get("vary")).toBe("accept");
    expect(await shell.text()).toContain("Shell in Korean");
    plain.remove();
  });
});

describe("files", () => {
  it("are served with a type, and for good when their name carries a hash", async () => {
    const bundle = answer("/assets/index-abc123.js");
    expect(bundle.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(bundle.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await bundle.text()).toContain("bundle");

    const icon = answer("/favicon.svg");
    expect(icon.headers.get("cache-control")).toBe("public, max-age=3600");
    const etag = icon.headers.get("etag") ?? "";
    expect(answer("/favicon.svg", { headers: { "if-none-match": etag } }).status).toBe(304);
    const head = answer("/favicon.svg", { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe(icon.headers.get("content-length"));
    expect(await head.text()).toBe("");
    expect(answer("/showcase/clip.mp4").headers.get("content-type")).toBe("video/mp4");
  });

  it("answer the byte ranges that video playback asks for", async () => {
    const path = "/showcase/clip.mp4";
    const whole = answer(path);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const size = Number(whole.headers.get("content-length"));
    const etag = whole.headers.get("etag") ?? "";

    const first = answer(path, { headers: { range: "bytes=0-4" } });
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe(`bytes 0-4/${size}`);
    expect(first.headers.get("content-length")).toBe("5");
    expect(await first.text()).toBe("not a");
    const last = answer(path, { headers: { range: "bytes=-4" } });
    expect(last.headers.get("content-range")).toBe(`bytes ${size - 4}-${size - 1}/${size}`);
    expect(await last.text()).toBe("one\n");
    const open = answer(path, { headers: { range: `bytes=${size - 2}-` } });
    expect(await open.text()).toBe("e\n");
    // A range that ends past the file ends at the file; the same file is still the one asked for.
    const clipped = answer(path, { headers: { range: `bytes=2-${size + 50}`, "if-range": etag } });
    expect(clipped.status).toBe(206);
    expect(clipped.headers.get("content-range")).toBe(`bytes 2-${size - 1}/${size}`);
    const head = answer(path, { method: "HEAD", headers: { range: "bytes=0-4" } });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-length")).toBe("5");
    expect(await head.text()).toBe("");

    // Nothing in the file: said so, with the size. Not a range we read: the whole file, as is a
    // range of a file the client saw another version of.
    const beyond = answer(path, { headers: { range: `bytes=${size}-` } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe(`bytes */${size}`);
    expect(answer(path, { headers: { range: "bytes=4-2" } }).status).toBe(416);
    for (const range of ["bytes=0-1,3-4", "bytes=-", "items=0-1", "bytes=a-b"]) {
      expect(answer(path, { headers: { range } }).status, range).toBe(200);
    }
    const changed = answer(path, { headers: { range: "bytes=0-4", "if-range": 'W/"other"' } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("content-length")).toBe(String(size));
    // Freshness comes first: a client that has the file gets nothing, range or not.
    expect(answer(path, { headers: { range: "bytes=0-4", "if-none-match": etag } }).status).toBe(
      304,
    );
  });

  it("do not include the manifest, pages under their file names, or anything outside", () => {
    for (const path of [
      "/routes.json",
      "/template.html",
      "/render/entry-server.js",
      "/index.html",
      "/index.ko.html",
      "/404.html",
      "/explore/index.html",
      "/assets/",
      "/assets/%2e%2e/routes.json",
      "/assets/..%2froutes.json",
      "/%2e%2e/%2e%2e/etc/passwd",
      "//etc/passwd",
      "/explore/",
    ]) {
      expect(web.respond(request(path)), path).toBeUndefined();
    }
    expect(web.respond(request("/", { method: "POST" }))).toBeUndefined();
  });
});

describe("what crawlers ask for", () => {
  it("is a sitemap of the indexable pages and the given addresses in every language, each pointing at the others", async () => {
    const xml = await web.sitemap(request("/sitemap.xml"), ["/gh/acme/skills"]).text();
    expect(xml.match(/<url>/g)).toHaveLength(9);
    expect(xml).toContain("<loc>https://skills.example/</loc>");
    // A page written in one language is listed in that one, however many frames it has.
    expect(xml).toContain("<loc>https://skills.example/docs/format</loc>");
    expect(xml).not.toContain("/docs/format?lang=ko");
    expect(xml).not.toContain("/docs/format.md");
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://skills.example/docs/format"/>',
    );
    expect(xml).toContain("<loc>https://skills.example/?lang=ko</loc>");
    expect(xml).toContain("<loc>https://skills.example/explore?lang=ko</loc>");
    expect(xml).toContain("<loc>https://skills.example/gh/acme/skills?lang=ko</loc>");
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="ko" href="https://skills.example/explore?lang=ko"/>',
    );
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://skills.example/"/>',
    );
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://skills.example/gh/acme/skills"/>',
    );
    expect(xml).not.toContain("llms.txt");
    expect(web.respond(request("/sitemap.xml"))).toBeUndefined();
  });

  it("serves a page of the documentation framed in the language asked, its Markdown beside it, and the words of its card", async () => {
    expect(await answer("/docs/format?lang=ko").text()).toContain("framed in Korean");
    expect(answer("/docs/format").headers.get("content-language")).toBe("en");
    const markdown = answer("/docs/format.md", { headers: { "accept-language": "ko" } });
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers.get("content-security-policy")).toBeNull();
    expect(await markdown.text()).toContain("[the tools](https://skills.example/docs/tools.md)");
    // The words of the card are the build's, in the language the request asks for.
    const card = web.docsSocial(request("/social/docs/format?lang=ko"), "format");
    expect(card).toMatchObject({
      language: "ko",
      forced: true,
      card: { title: "The format", subtitle: "skills.example/docs/format (ko)", avatar: "" },
    });
    expect(web.docsSocial(request("/social/docs"), "")?.card.title).toBe("Documentation");
    expect(web.docsSocial(request("/social/docs/nothing"), "nothing")).toBeUndefined();
  });

  it("is a robots.txt that keeps crawlers away from the API and nothing else", async () => {
    const robots = await answer("/robots.txt").text();
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).not.toContain("Disallow: /gh/");
    expect(robots).toContain("Sitemap: https://skills.example/sitemap.xml");
  });
});

describe("the tags an operator configures", () => {
  it("go into the head of every page, with the policy widened for exactly them", async () => {
    const tagged = await loadWebBundle(build.root, {
      publicUrl: "https://skills.example",
      tags: {
        googleSiteVerification: 'abc"><script>x</script>',
        googleAnalyticsId: "G-ABC123XYZ",
        termsUrl: "https://skills.example/terms",
        privacyUrl: 'https://skills.example/privacy?v=2&x="',
        contactEmail: "content@skills.example",
      },
    });
    const response = tagged.respond(request("/?lang=ko"));
    const html = (await response?.text()) ?? "";
    expect(html).toContain(
      '<head>\n<meta name="skillcdn-analytics" content="ask">\n<meta name="google-site-verification" content="abc&quot;>&lt;script>x&lt;/script>">',
    );
    // The deployment's own pages, as standard link types, and its contact for the footer.
    expect(html).toContain('<link rel="terms-of-service" href="https://skills.example/terms">');
    expect(html).toContain(
      '<link rel="privacy-policy" href="https://skills.example/privacy?v=2&amp;x=&quot;">',
    );
    expect(html).toContain('<meta name="skillcdn-contact" content="content@skills.example">');
    // Analytics are consent mode first (ADR-0051): denied by default in the regions that ask,
    // granted elsewhere, advertising denied everywhere; a meta written per request says whether
    // this visitor is asked, and one whose region is not known is. The page loads the script
    // only when the visitor is not to be asked or has agreed, and a privacy signal keeps it off
    // (deploy/README.md). The script sends no page view of its own; the pages do, once told
    // that they may (ADR-0050).
    expect(html).toContain('<meta name="skillcdn-analytics" content="ask">');
    expect(html.indexOf('<meta name="skillcdn-analytics"')).toBeLessThan(
      html.indexOf("window.dataLayer="),
    );
    expect(html).toContain('var id="G-ABC123XYZ"');
    expect(html).toContain(
      'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied",region:["AT","BE",',
    );
    expect(html).toContain('"GB","CH"]});');
    expect(html).toContain(
      'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"granted"});',
    );
    expect(html).toContain("navigator.globalPrivacyControl===true");
    expect(html).not.toContain("doNotTrack");
    expect(html).toContain('"https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(id)');
    expect(html).toContain(
      "var state={ask:!refused&&asks&&stored===null,active:false,refused:refused,decide:decide};",
    );
    expect(html).toContain("window.skillcdnAnalytics=state;");
    expect(html).toContain('gtag("config",id,{send_page_view:false})');
    expect(html).toContain('window.dispatchEvent(new Event("skillcdn:analytics"))');
    expect(html).not.toContain('<script async src="https://www.googletagmanager.com');
    const policy = response?.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(
      /script-src 'self' https:\/\/\*\.googletagmanager\.com 'sha256-[A-Za-z0-9+/=]+'/,
    );
    expect(policy).toContain("connect-src 'self' https://*.google-analytics.com");
    expect(policy).not.toContain("unsafe");
    // The page of an address is rendered into the same document, tags included.
    const page = await tagged
      .address(request("/gh/acme/skills"), { mount: { ready: { index: { status: "ready" } } } })
      .text();
    expect(page).toContain('<meta name="google-site-verification"');
    expect(page).toContain('var id="G-ABC123XYZ"');
    expect(page).toContain('<meta name="skillcdn-analytics" content="ask">');
    // Not into what is not a page.
    expect(await tagged.respond(request("/llms.txt"))?.text()).not.toContain("gtag");
  });

  it("say per request whether the visitor is asked before analytics run, by their region", async () => {
    const consentOf = async (bundle: WebBundle, country?: string): Promise<string | undefined> =>
      /<meta name="skillcdn-analytics" content="(\w+)">/.exec(
        (await bundle.respond(request("/", { country }))?.text()) ?? "",
      )?.[1];
    const withRegions = (analyticsConsentRegions?: "*" | readonly string[]) =>
      loadWebBundle(build.root, {
        publicUrl: "https://skills.example",
        tags: { googleAnalyticsId: "G-ABC123XYZ", analyticsConsentRegions },
      });
    // The default regions: the European Economic Area, the United Kingdom and Switzerland.
    const tagged = await withRegions();
    expect(await consentOf(tagged, "DE")).toBe("ask");
    expect(await consentOf(tagged, "NO")).toBe("ask");
    expect(await consentOf(tagged, "GB")).toBe("ask");
    expect(await consentOf(tagged, "KR")).toBe("run");
    expect(await consentOf(tagged, "US-CA")).toBe("run");
    // Not knowing where the visitor is, the page asks.
    expect(await consentOf(tagged)).toBe("ask");
    // Regions of the operator's own, a subdivision among them; everywhere; nowhere. The
    // service's own defaults name the same regions, and none when there are none to name.
    const some = await withRegions(["US-CA", "BR"]);
    expect(await consentOf(some, "US")).toBe("run");
    expect(await consentOf(some, "US-CA")).toBe("ask");
    expect(await consentOf(some, "DE")).toBe("run");
    expect(await some.respond(request("/"))?.text()).toContain('region:["US-CA","BR"]});');
    const everywhere = await withRegions("*");
    expect(await consentOf(everywhere, "KR")).toBe("ask");
    const granted =
      'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"granted"});';
    const everywhereHtml = (await everywhere.respond(request("/"))?.text()) ?? "";
    expect(everywhereHtml).not.toContain("region:");
    expect(everywhereHtml).not.toContain(granted);
    const nowhere = await withRegions([]);
    expect(await consentOf(nowhere, "DE")).toBe("run");
    expect(await consentOf(nowhere)).toBe("run");
    const nowhereHtml = (await nowhere.respond(request("/"))?.text()) ?? "";
    expect(nowhereHtml).not.toContain("region:");
    expect(nowhereHtml).toContain(granted);
    // Without analytics there is nothing to say.
    expect(await consentOf(web, "DE")).toBeUndefined();
  });

  it("tell the pages which sections the front page shows and whether the search is there, and render what depends on it", async () => {
    const tagged = await loadWebBundle(build.root, {
      publicUrl: "https://skills.example",
      tags: { landingSections: ["packs", "faq"], search: false },
    });
    const explore = tagged.respond(request("/explore?lang=ko"));
    const html = (await explore?.text()) ?? "";
    // The tags are in the head, and a page that depends on them is rendered rather than served
    // as the build prerendered it, in the language asked.
    expect(html).toContain('<meta name="skillcdn-landing" content="packs,faq">');
    expect(html).toContain('<meta name="skillcdn-search" content="off">');
    expect(html).toContain("<title>Rendered site page /explore</title>");
    expect(html).toContain('<html lang="ko">');
    expect(explore?.headers.get("content-language")).toBe("ko");
    const input = JSON.parse(/<pre id="input">(.*?)<\/pre>/s.exec(html)?.[1] ?? "{}");
    expect(input).toEqual({
      language: "ko",
      origin: "https://skills.example",
      pathname: "/explore",
      search: "?lang=ko",
      features: { landingSections: ["packs", "faq"], search: false },
    });
    // What is not a page of the build is still a file, and a file is still a file.
    expect(await tagged.respond(request("/llms.txt"))?.text()).toContain("# Site");
    expect(tagged.respond(request("/favicon.svg"))?.headers.get("content-type")).toBe(
      "image/svg+xml",
    );
    // Every render carries the features: the front page and a search page too.
    const front = JSON.parse(
      /<pre id="input">(.*?)<\/pre>/s.exec(
        (await tagged.landing(request("/"), undefined)?.text()) ?? "",
      )?.[1] ?? "{}",
    );
    expect(front).toMatchObject({ features: { landingSections: ["packs", "faq"] }, data: {} });
    const searched = tagged.search(
      request("/search/decks"),
      { results: { ready: { status: "ready", query: "decks", packs: 1, items: [] } } },
      200,
      { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=300" },
    );
    expect(searched.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
    );
    expect(searched.headers.get("vary")).toBe("accept-language");
    expect(await searched.text()).toContain("<title>Rendered search /search/decks</title>");
    // Everything as the build assumed: the prerendered pages answer, with nothing in the head.
    const plain = await answer("/explore").text();
    expect(plain).toContain("Explore");
    expect(plain).not.toContain("skillcdn-landing");
    expect(plain).not.toContain("skillcdn-search");
  });

  it("are absent, and so is the widening, when nothing is configured", async () => {
    const html = await answer("/").text();
    expect(html).not.toContain("gtag");
    expect(html).not.toContain("skillcdn-analytics");
    expect(html).not.toContain("google-site-verification");
    expect(html).not.toContain("terms-of-service");
    expect(html).not.toContain("privacy-policy");
    expect(html).not.toContain("skillcdn-contact");
    expect(answer("/").headers.get("content-security-policy")).toContain("script-src 'self';");
  });
});

describe("loadWebBundle", () => {
  it("refuses a directory that is not a web build", async () => {
    const empty = createWebBuild("not a manifest");
    await expect(loadWebBundle(empty.root, { publicUrl: undefined })).rejects.toBeInstanceOf(
      WebBundleError,
    );
    empty.remove();
    await expect(
      loadWebBundle("/this/directory/does/not/exist", { publicUrl: undefined }),
    ).rejects.toBeInstanceOf(WebBundleError);
  });

  it("refuses a page listed in a language it has no file for", async () => {
    const listed = createWebBuild({
      ...WEB_BUILD_MANIFEST,
      routes: [
        ...WEB_BUILD_MANIFEST.routes,
        { path: "/docs/more", files: { en: "index.html" }, indexable: true, alternates: ["fr"] },
      ],
    });
    await expect(loadWebBundle(listed.root, { publicUrl: undefined })).rejects.toThrow(
      /\/docs\/more is listed in a language it has no file for/,
    );
    listed.remove();
  });

  it("refuses a render module that cannot be loaded, or one without a template", async () => {
    const broken = createWebBuild();
    broken.write("render/entry-server.js", "export const nothing = 1;\n");
    await expect(loadWebBundle(broken.root, { publicUrl: undefined })).rejects.toThrow(
      /renderAddressPage/,
    );
    broken.remove();
    const halved = createWebBuild(
      { ...WEB_BUILD_MANIFEST, render: "render/entry-server.js" },
      {
        render: false,
      },
    );
    await expect(loadWebBundle(halved.root, { publicUrl: undefined })).rejects.toBeInstanceOf(
      WebBundleError,
    );
    halved.remove();
  });

  it("refuses a manifest that points outside the directory or at nothing", async () => {
    for (const file of ["../secret.html", "/etc/passwd", "C:\\secret.html", "missing.html"]) {
      const hostile = createWebBuild({
        ...WEB_BUILD_MANIFEST,
        shell: { en: file },
      });
      await expect(
        loadWebBundle(hostile.root, { publicUrl: undefined }),
        file,
      ).rejects.toBeInstanceOf(WebBundleError);
      hostile.remove();
    }
  });
});

describe("wantsHtml", () => {
  it("tells a browser asking for a page from a client of the protocol", () => {
    const browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    expect(wantsHtml(request("/", { headers: { accept: browser } }))).toBe(true);
    expect(wantsHtml(request("/", { method: "HEAD", headers: { accept: browser } }))).toBe(true);
    expect(wantsHtml(request("/", { method: "POST", headers: { accept: browser } }))).toBe(false);
    expect(
      wantsHtml(request("/", { headers: { accept: "application/json, text/event-stream" } })),
    ).toBe(false);
    expect(wantsHtml(request("/", { headers: { accept: "text/event-stream" } }))).toBe(false);
    expect(wantsHtml(request("/", { headers: { accept: "application/json" } }))).toBe(false);
  });

  it("gives the page to a link unfurler, which asks for anything or for nothing", () => {
    expect(wantsHtml(request("/", { headers: { accept: "*/*" } }))).toBe(true);
    expect(wantsHtml(request("/"))).toBe(true);
    expect(wantsHtml(request("/", { method: "HEAD" }))).toBe(true);
    expect(wantsHtml(request("/", { method: "POST" }))).toBe(false);
  });
});

describe("negotiateLanguage", () => {
  const available = ["en", "ko"];

  it("takes the heaviest language the build has, then the first written, by tag or primary subtag", () => {
    expect(negotiateLanguage("ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7", available)).toBe("ko");
    expect(negotiateLanguage("en-GB, ko", available)).toBe("en");
    expect(negotiateLanguage("fr-FR, de;q=0.9, ko;q=0.5, en;q=0.4", available)).toBe("ko");
    expect(negotiateLanguage("en;q=0.5, ko;q=0.8", available)).toBe("ko");
    expect(negotiateLanguage("KO", available)).toBe("ko");
    expect(negotiateLanguage("pt-BR, en", ["en", "pt-BR"])).toBe("pt-BR");
    expect(negotiateLanguage("pt-PT", ["en", "pt-BR"])).toBeUndefined();
  });

  it("asks for nothing without the header, with none the build has, or with nothing well formed", () => {
    expect(negotiateLanguage(null, available)).toBeUndefined();
    expect(negotiateLanguage("", available)).toBeUndefined();
    expect(negotiateLanguage("fr, de", available)).toBeUndefined();
    expect(negotiateLanguage("*", available)).toBeUndefined();
    expect(negotiateLanguage("ko;q=0, fr", available)).toBeUndefined();
    expect(negotiateLanguage("ko;q=abc", available)).toBeUndefined();
    expect(negotiateLanguage("ko;q=2", available)).toBeUndefined();
    expect(negotiateLanguage("<script>, ko_KR, ../ko", available)).toBeUndefined();
  });

  it("reads a bounded part of a hostile header", () => {
    // Past the ranges it reads, a language is not found; the work stays small either way.
    expect(negotiateLanguage(`${"fr, ".repeat(40)}ko`, available)).toBeUndefined();
    expect(negotiateLanguage(`${"x".repeat(5000)}, ko`, available)).toBeUndefined();
    expect(negotiateLanguage(`ko, ${"x".repeat(5000)}`, available)).toBe("ko");
  });
});
