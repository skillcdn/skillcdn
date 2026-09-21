import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebBuild, WEB_BUILD_MANIFEST, type WebBuildFixture } from "../testing/web-build.js";
import {
  loadWebBundle,
  type WebBundle,
  WebBundleError,
  type WebRequest,
  wantsHtml,
} from "./web.js";

const request = (
  path: string,
  init: { method?: string; headers?: Record<string, string>; origin?: string } = {},
): WebRequest => ({
  method: init.method ?? "GET",
  url: new URL(path, init.origin ?? "http://internal.test:8080"),
  headers: new Headers(init.headers),
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
  it("are chosen by path and by the language parameter, never by Accept-Language", async () => {
    const english = answer("/", { headers: { "accept-language": "ko-KR" } });
    expect(english.headers.get("content-language")).toBe("en");
    expect(await english.text()).toContain('<html lang="en">');

    const korean = answer("/?lang=ko");
    expect(korean.headers.get("content-language")).toBe("ko");
    expect(await korean.text()).toContain("Front page in Korean");
    expect(await answer("/explore?lang=ko&utm=x").text()).toContain("Explore in Korean");
    // A language we do not have is the default language, not an error.
    expect(await answer("/?lang=fr").text()).toContain('<html lang="en">');
    expect(await answer("/?lang=KO").text()).toContain('<html lang="en">');
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

  it("include the frame for addresses and the page for what is missing", async () => {
    const shell = web.shell(request("/gh/acme/skills?lang=ko"));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("Shell in Korean");
    const missing = web.notFound(request("/nothing"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Not found");
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
  });

  it("do not include the manifest, pages under their file names, or anything outside", () => {
    for (const path of [
      "/routes.json",
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
  it("is a sitemap of the indexable pages in every language, each pointing at the others", async () => {
    const xml = await answer("/sitemap.xml").text();
    expect(xml.match(/<url>/g)).toHaveLength(4);
    expect(xml).toContain("<loc>https://skills.example/</loc>");
    expect(xml).toContain("<loc>https://skills.example/?lang=ko</loc>");
    expect(xml).toContain("<loc>https://skills.example/explore?lang=ko</loc>");
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="ko" href="https://skills.example/explore?lang=ko"/>',
    );
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://skills.example/"/>',
    );
    expect(xml).not.toContain("llms.txt");
  });

  it("is a robots.txt that keeps crawlers away from what costs work", async () => {
    const robots = await answer("/robots.txt").text();
    expect(robots).toContain("Disallow: /gh/");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: https://skills.example/sitemap.xml");
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
  it("tells a browser asking for a page from a client of an API", () => {
    const browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    expect(wantsHtml(request("/", { headers: { accept: browser } }))).toBe(true);
    expect(wantsHtml(request("/", { method: "HEAD", headers: { accept: browser } }))).toBe(true);
    expect(wantsHtml(request("/", { method: "POST", headers: { accept: browser } }))).toBe(false);
    expect(
      wantsHtml(request("/", { headers: { accept: "application/json, text/event-stream" } })),
    ).toBe(false);
    expect(wantsHtml(request("/", { headers: { accept: "*/*" } }))).toBe(false);
    expect(wantsHtml(request("/"))).toBe(false);
  });
});
