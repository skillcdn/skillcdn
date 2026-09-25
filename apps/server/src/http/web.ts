import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import * as z from "zod";

// Serves a build of the web UI (ADR-0009). The server knows nothing about the UI: the build
// brings a manifest that says which file answers which URL in which language, and everything
// else in the directory is a static file. A deployment without a web build simply has no UI.
// A build may also bring a module that renders the view of an address with its data, which the
// server calls per request (ADR-0011); without it, addresses get the shell.

const relativeFile = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (file) =>
      !file.startsWith("/") &&
      !file.includes("\\") &&
      !file.includes(":") &&
      !file.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    "must be a relative path inside the web root",
  );

const language = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/);
const filesByLanguage = z.record(language, relativeFile);

const manifestSchema = z.object({
  version: z.literal(1),
  defaultLanguage: language,
  languages: z.array(language).min(1).max(64),
  /** The query parameter that selects the language. Paths are the same in every language. */
  languageParam: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  /** What stands in for the public origin in the pages. */
  originPlaceholder: z.url({ protocol: /^https?$/ }),
  routes: z
    .array(
      z.object({
        path: z.string().regex(/^\/[A-Za-z0-9._~/-]*$/),
        files: filesByLanguage,
        /** Listed in the sitemap. */
        indexable: z.boolean(),
        contentType: z.string().max(100).optional(),
      }),
    )
    .max(1000),
  /** The frame for pages that render in the browser. */
  shell: filesByLanguage,
  notFound: filesByLanguage,
  /** A module that renders the view of an address, and the document it renders into. */
  render: relativeFile.optional(),
  template: relativeFile.optional(),
});

const MANIFEST_FILE = "routes.json";
const MAX_STATIC_FILES = 5000;
const HTML = "text/html; charset=utf-8";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

/**
 * Tags an operator adds to every page: a search console's proof of ownership, analytics, and
 * the deployment's legal surface (ADR-0026): where its terms and privacy pages are, and whom
 * to write to about content. The pages show each of these only when it is set.
 */
export interface PageTags {
  readonly googleSiteVerification?: string | undefined;
  readonly googleAnalyticsId?: string | undefined;
  readonly termsUrl?: string | undefined;
  readonly privacyUrl?: string | undefined;
  readonly contactEmail?: string | undefined;
}

/** How the legal surface travels into a page: standard link types, and one meta for the contact. */
export const LEGAL_TAGS = {
  terms: "terms-of-service",
  privacy: "privacy-policy",
  contact: "skillcdn-contact",
} as const;

/** Where the analytics script comes from and talks to, as its documentation lists them. */
const ANALYTICS_SOURCES = {
  script: ["https://*.googletagmanager.com"],
  images: ["https://*.google-analytics.com", "https://*.googletagmanager.com"],
  connections: [
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
  ],
} as const;

const escapeAttribute = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/**
 * Pages render repository content, which is untrusted. Nothing inline runs, nothing loads from
 * elsewhere, and nobody frames the page. With analytics configured, the one inline script that
 * starts it is allowed by its hash, and its sources by name.
 */
function pageHeaders(tags: PageTags, inlineScripts: readonly string[]): Record<string, string> {
  const analytics = tags.googleAnalyticsId !== undefined;
  const hashes = inlineScripts.map(
    (script) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
  );
  const sources = (own: string, more: readonly string[]) =>
    analytics ? [own, ...more].join(" ") : own;
  return {
    "content-security-policy": [
      "default-src 'self'",
      `script-src ${sources("'self'", [...ANALYTICS_SOURCES.script, ...hashes])}`,
      "style-src 'self'",
      `img-src ${sources("'self' data:", ANALYTICS_SOURCES.images)}`,
      "font-src 'self'",
      `connect-src ${sources("'self'", ANALYTICS_SOURCES.connections)}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
  };
}

/** The elements the tags become, and the inline scripts among them, for the policy. */
function headTags(tags: PageTags): { readonly html: string; readonly inlineScripts: string[] } {
  const elements: string[] = [];
  const inlineScripts: string[] = [];
  if (tags.googleSiteVerification !== undefined) {
    elements.push(
      `<meta name="google-site-verification" content="${escapeAttribute(tags.googleSiteVerification)}">`,
    );
  }
  if (tags.termsUrl !== undefined) {
    elements.push(`<link rel="${LEGAL_TAGS.terms}" href="${escapeAttribute(tags.termsUrl)}">`);
  }
  if (tags.privacyUrl !== undefined) {
    elements.push(`<link rel="${LEGAL_TAGS.privacy}" href="${escapeAttribute(tags.privacyUrl)}">`);
  }
  if (tags.contactEmail !== undefined) {
    elements.push(
      `<meta name="${LEGAL_TAGS.contact}" content="${escapeAttribute(tags.contactEmail)}">`,
    );
  }
  if (tags.googleAnalyticsId !== undefined) {
    // Consent first: consent mode starts with everything denied, nothing is loaded and nothing is
    // stored until the visitor agrees in the banner the pages show, and a browser that signals a
    // privacy preference (Global Privacy Control, Do Not Track) is never asked and never loads it.
    // One line, so that its hash in the policy is stable; the banner talks to `skillcdnAnalytics`.
    const bootstrap = [
      "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;",
      'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied"});',
      `(function(){var id=${JSON.stringify(tags.googleAnalyticsId)};var key="skillcdn-consent";`,
      'var refused=navigator.globalPrivacyControl===true||navigator.doNotTrack==="1";',
      "var stored=null;try{stored=localStorage.getItem(key)}catch(e){}",
      'function load(){gtag("consent","update",{analytics_storage:"granted"});var s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(id);document.head.appendChild(s);gtag("js",new Date());gtag("config",id)}',
      'window.skillcdnAnalytics={ask:!refused&&stored===null,decide:function(granted){try{localStorage.setItem(key,granted?"granted":"denied")}catch(e){}if(granted&&!refused){load()}}};',
      'if(!refused&&stored==="granted"){load()}})()',
    ].join("");
    inlineScripts.push(bootstrap);
    elements.push(`<script>${bootstrap}</script>`);
  }
  return { html: elements.join("\n"), inlineScripts };
}

const HEAD_OPEN = /<head(\s[^>]*)?>/i;

export class WebBundleError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WebBundleError";
  }
}

interface StaticFile {
  readonly file: string;
  readonly size: number;
  readonly etag: string;
  readonly contentType: string;
  readonly cacheControl: string;
}

export interface WebRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
}

/** An answer the page would otherwise ask the REST API for, given to it up front. */
export type PageAnswer =
  | { readonly ready: unknown }
  | {
      readonly error: {
        readonly status: number;
        readonly code: string;
        readonly message: string;
        readonly directories?: readonly string[];
      };
    };

/** What the server knows about an address when a browser asks for its page. */
export interface AddressData {
  readonly browse?: PageAnswer;
  readonly find?: PageAnswer;
  /** What the address serves, or why it does not. Left out for a path that is not an address. */
  readonly mount?: PageAnswer;
  /** The skill the URL asks for, when it asks for one. */
  readonly skill?: PageAnswer;
}

/** The contract of the render module in a build, as the UI defines it. */
interface RenderModule {
  renderAddressPage(
    template: string,
    input: {
      readonly language: string;
      readonly origin: string;
      readonly pathname: string;
      readonly search: string;
      readonly data: AddressData;
    },
  ): { readonly html: string; readonly indexable: boolean };
}

export interface WebBundle {
  /** A page or a file of the build, or robots.txt. `undefined`: not ours to answer. */
  respond(request: WebRequest): Response | undefined;
  /**
   * The view of an address, rendered with what the server knows about it when the build can
   * render, else the frame in which the browser renders it.
   */
  address(request: WebRequest, data: AddressData, status?: number): Response;
  /** The sitemap: the indexable pages of the build, and these addresses, in every language. */
  sitemap(request: WebRequest, addresses: readonly string[]): Response;
  /** The page for a URL that is nothing, with status 404. */
  notFound(request: WebRequest): Response;
}

/** True when the request is a browser asking for a page, as opposed to a client of an API. */
export function wantsHtml(request: Pick<WebRequest, "method" | "headers">): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    (request.headers.get("accept") ?? "").toLowerCase().includes("text/html")
  );
}

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex").slice(0, 16);

/** How much of an Accept-Language header is read: plenty for any real one. */
const MAX_ACCEPT_LANGUAGE = 1024;
const MAX_LANGUAGE_RANGES = 32;

/**
 * The language of `available` that an Accept-Language header asks for first: by weight, then in
 * the order written, a tag matching exactly or by its primary subtag (`ko-KR` is `ko`). A range
 * of weight 0, a wildcard and a malformed weight ask for nothing. `undefined` when none of them
 * is available (ADR-0021).
 */
export function negotiateLanguage(
  header: string | null,
  available: readonly string[],
): string | undefined {
  if (header === null) {
    return undefined;
  }
  const ranges = header
    .slice(0, MAX_ACCEPT_LANGUAGE)
    .split(",")
    .slice(0, MAX_LANGUAGE_RANGES)
    .map((part, index) => {
      const [tag = "", ...parameters] = part.split(";").map((piece) => piece.trim());
      const q = parameters.find((parameter) => /^q=/i.test(parameter));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { tag: tag.toLowerCase(), weight, index };
    })
    .filter(
      (range) =>
        /^[a-z]{1,8}(-[a-z0-9]{1,8})*$/.test(range.tag) &&
        Number.isFinite(range.weight) &&
        range.weight > 0 &&
        range.weight <= 1,
    )
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranges) {
    const primary = tag.split("-")[0];
    const found =
      available.find((code) => code.toLowerCase() === tag) ??
      available.find((code) => code.toLowerCase() === primary);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The one range of bytes a request asks for, out of `size`. `undefined` for a header we do not
 * read (several ranges, or something else), which is answered with the whole file as the
 * standard allows; `null` for a range that is well formed but not in the file.
 */
function byteRange(header: string, size: number): ByteRange | null | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const from = match[1] ?? "";
  const to = match[2] ?? "";
  if (from === "" && to === "") {
    return undefined;
  }
  if (from === "") {
    // The last so many bytes.
    const count = Number(to);
    return count === 0 || size === 0 ? null : { start: Math.max(size - count, 0), end: size - 1 };
  }
  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  return start >= size || start > end ? null : { start, end };
}

const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        // Links are not followed: what is served is what is in the directory.
        found.push(relative);
        if (found.length > MAX_STATIC_FILES) {
          throw new WebBundleError(`more than ${MAX_STATIC_FILES} files in the web root`);
        }
      }
    }
  };
  await walk(root, "");
  return found;
}

async function loadRenderModule(root: string, file: string): Promise<RenderModule> {
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(join(root, ...file.split("/"))).href);
  } catch (error) {
    throw new WebBundleError(
      `the manifest names ${file} as the render module, which cannot be loaded`,
      {
        cause: error,
      },
    );
  }
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    !("renderAddressPage" in loaded) ||
    typeof loaded.renderAddressPage !== "function"
  ) {
    throw new WebBundleError(`${file} does not export renderAddressPage`);
  }
  return loaded as RenderModule;
}

/**
 * Reads a web build from disk, once. Pages are kept in memory because the public origin is
 * written into them per request; files are streamed from disk. Throws when the directory is
 * not a web build. The web root is code as much as content: the render module in it runs in
 * this process, so only ever point the server at a build you made.
 */
export async function loadWebBundle(
  root: string,
  options: { readonly publicUrl: string | undefined; readonly tags?: PageTags },
): Promise<WebBundle> {
  const tags = headTags(options.tags ?? {});
  const PAGE_HEADERS = pageHeaders(options.tags ?? {}, tags.inlineScripts);
  let manifest: z.infer<typeof manifestSchema>;
  try {
    manifest = manifestSchema.parse(JSON.parse(await readFile(join(root, MANIFEST_FILE), "utf8")));
  } catch (error) {
    throw new WebBundleError(`${MANIFEST_FILE} in the web root is missing or not a manifest`, {
      cause: error,
    });
  }
  const { defaultLanguage, languages, languageParam, originPlaceholder } = manifest;
  const hostPlaceholder = originPlaceholder.replace(/^https?:\/\//, "");
  for (const files of [manifest.shell, manifest.notFound, ...manifest.routes.map((r) => r.files)]) {
    if (files[defaultLanguage] === undefined) {
      throw new WebBundleError("a page in the manifest has no file for the default language");
    }
  }

  /** Page files of the manifest, as text with placeholders, and with the operator's tags. */
  const pages = new Map<string, string>();
  const pageOf = async (file: string): Promise<string> => {
    let found = pages.get(file);
    if (found === undefined) {
      try {
        found = await readFile(join(root, ...file.split("/")), "utf8");
      } catch (error) {
        throw new WebBundleError(`the manifest names ${file}, which cannot be read`, {
          cause: error,
        });
      }
      if (tags.html !== "" && file.endsWith(".html")) {
        const opened = HEAD_OPEN.exec(found);
        if (opened === null) {
          throw new WebBundleError(`${file} has no head element to put the tags in`);
        }
        const at = opened.index + opened[0].length;
        found = `${found.slice(0, at)}\n${tags.html}${found.slice(at)}`;
      }
      pages.set(file, found);
    }
    return found;
  };
  for (const files of [manifest.shell, manifest.notFound, ...manifest.routes.map((r) => r.files)]) {
    for (const file of Object.values(files)) {
      await pageOf(file);
    }
  }

  let renderer: { readonly module: RenderModule; readonly template: string } | undefined;
  if (manifest.render !== undefined && manifest.template !== undefined) {
    renderer = {
      module: await loadRenderModule(root, manifest.render),
      template: await pageOf(manifest.template),
    };
  } else if (manifest.render !== undefined || manifest.template !== undefined) {
    throw new WebBundleError(
      "the manifest names a render module without a template, or the reverse",
    );
  }
  const renderDirectory = manifest.render?.split("/").slice(0, -1).join("/");

  // Everything else in the directory is a static file, except what only the manifest may serve:
  // a page under its file name would be a second URL for the same content, and the render
  // module is for this process, not for browsers.
  const statics = new Map<string, StaticFile>();
  for (const relative of await listFiles(root)) {
    if (
      relative === MANIFEST_FILE ||
      pages.has(relative) ||
      relative.endsWith(".html") ||
      (renderDirectory !== undefined &&
        renderDirectory !== "" &&
        relative.startsWith(`${renderDirectory}/`))
    ) {
      continue;
    }
    const file = join(root, ...relative.split("/"));
    const info = await stat(file);
    statics.set(`/${relative}`, {
      file,
      size: info.size,
      etag: `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
      contentType: CONTENT_TYPES[extname(relative).toLowerCase()] ?? "application/octet-stream",
      // Bundler output carries a content hash in its name and never changes.
      cacheControl: relative.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    });
  }

  const routes = new Map(manifest.routes.map((route) => [route.path, route]));
  const originOf = (request: WebRequest): string => options.publicUrl ?? request.url.origin;
  /**
   * The language of a page: the one the parameter names, when the build has it; else the one the
   * request asks for; else the default (ADR-0021). Only the first is the same for every request.
   */
  const languageOf = (
    request: WebRequest,
  ): { readonly language: string; readonly forced: boolean } => {
    const asked = request.url.searchParams.get(languageParam);
    if (asked !== null && languages.includes(asked)) {
      return { language: asked, forced: true };
    }
    return {
      language:
        negotiateLanguage(request.headers.get("accept-language"), languages) ?? defaultLanguage,
      forced: false,
    };
  };
  /** A response that depends on Accept-Language says so, next to whatever else it varies on. */
  const varyOn = (forced: boolean, also: string | undefined): Record<string, string> => {
    const on = [...(also === undefined ? [] : [also]), ...(forced ? [] : ["accept-language"])];
    return on.length === 0 ? {} : { vary: on.join(", ") };
  };
  const notModified = (request: WebRequest, etag: string): boolean =>
    (request.headers.get("if-none-match") ?? "")
      .split(",")
      .some((candidate) => candidate.trim() === etag);
  const withOrigin = (text: string, origin: string): string =>
    text
      .replaceAll(originPlaceholder, origin)
      .replaceAll(hostPlaceholder, origin.replace(/^https?:\/\//, ""));

  const text = (
    request: WebRequest,
    body: string,
    headers: Record<string, string>,
    status = 200,
  ): Response => {
    const etag = `W/"${sha1(body)}"`;
    const all = { ...headers, etag, "x-content-type-options": "nosniff" };
    if (status === 200 && notModified(request, etag)) {
      return new Response(null, { status: 304, headers: all });
    }
    return new Response(request.method === "HEAD" ? null : body, { status, headers: all });
  };

  const html = (
    request: WebRequest,
    body: string,
    language: string,
    status: number,
    extra: Record<string, string> = {},
  ): Response =>
    text(
      request,
      body,
      {
        "content-type": HTML,
        "content-language": language,
        // One URL, one representation: a cache may keep it, but has to ask whether it changed.
        "cache-control": "public, max-age=0, must-revalidate",
        ...PAGE_HEADERS,
        ...extra,
      },
      status,
    );

  const page = (
    request: WebRequest,
    files: Record<string, string>,
    contentType: string,
    status = 200,
    extra: Record<string, string> = {},
  ): Response => {
    const { language: chosen, forced } = languageOf(request);
    const found = pages.get(files[chosen] ?? files[defaultLanguage] ?? "");
    if (found === undefined) {
      throw new WebBundleError("a page of the manifest was not loaded");
    }
    const body = withOrigin(found, originOf(request));
    const language = files[chosen] === undefined ? defaultLanguage : chosen;
    const vary = varyOn(forced, extra.vary);
    if (contentType === HTML) {
      return html(request, body, language, status, { ...extra, ...vary });
    }
    return text(
      request,
      body,
      {
        "content-type": contentType,
        "content-language": language,
        "cache-control": "public, max-age=0, must-revalidate",
        ...vary,
      },
      status,
    );
  };

  const urlIn = (origin: string, path: string, code: string): string =>
    code === defaultLanguage
      ? `${origin}${path}`
      : `${origin}${path}?${languageParam}=${encodeURIComponent(code)}`;

  const sitemapEntry = (origin: string, path: string, available: readonly string[]): string[] => {
    const alternates = [
      ...available.map((code) => [code, urlIn(origin, path, code)] as const),
      ["x-default", urlIn(origin, path, defaultLanguage)] as const,
    ]
      .map(
        ([code, href]) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(code)}" href="${escapeXml(href)}"/>`,
      )
      .join("\n");
    return available.map(
      (code) =>
        `  <url>\n    <loc>${escapeXml(urlIn(origin, path, code))}</loc>\n${alternates}\n  </url>`,
    );
  };

  const sitemap = (request: WebRequest, addresses: readonly string[]): Response => {
    const origin = originOf(request);
    const entries = [
      ...manifest.routes
        .filter((route) => route.indexable)
        .flatMap((route) =>
          sitemapEntry(
            origin,
            route.path,
            languages.filter((code) => route.files[code] !== undefined),
          ),
        ),
      ...addresses.flatMap((address) => sitemapEntry(origin, address, languages)),
    ];
    return text(
      request,
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`,
      { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
    );
  };

  const robots = (request: WebRequest): Response =>
    text(
      request,
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${originOf(request)}/sitemap.xml\n`,
      { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
    );

  // Files answer byte ranges: a phone plays a video by asking for pieces of it, and some will
  // not play at all from a server that only ever sends the whole file.
  const file = (request: WebRequest, found: StaticFile): Response => {
    const headers: Record<string, string> = {
      "content-type": found.contentType,
      "cache-control": found.cacheControl,
      etag: found.etag,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
    };
    if (notModified(request, found.etag)) {
      return new Response(null, { status: 304, headers });
    }
    // A range is only honored for the file the client has a piece of; else it gets the whole.
    const asked = request.headers.get("range");
    const ifRange = request.headers.get("if-range");
    const range =
      asked === null || (ifRange !== null && ifRange.trim() !== found.etag)
        ? undefined
        : byteRange(asked, found.size);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${found.size}` },
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? found.size - 1;
    const status = range === undefined ? 200 : 206;
    headers["content-length"] = String(found.size === 0 ? 0 : end - start + 1);
    if (range !== undefined) {
      headers["content-range"] = `bytes ${start}-${end}/${found.size}`;
    }
    if (request.method === "HEAD") {
      return new Response(null, { status, headers });
    }
    const stream = Readable.toWeb(
      createReadStream(found.file, range === undefined ? {} : { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, { status, headers });
  };

  // On an address the response depends on the Accept header: a page here, MCP otherwise.
  const ADDRESS_HEADERS = { vary: "accept" };

  return {
    respond(request) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return undefined;
      }
      const path = request.url.pathname;
      const route = routes.get(path);
      if (route !== undefined) {
        return page(request, route.files, route.contentType ?? HTML);
      }
      // The lookup is by exact URL path in a list made at startup: no path is ever built from
      // what a request says, so there is nothing to traverse.
      const found = statics.get(path);
      if (found !== undefined) {
        return file(request, found);
      }
      return path === "/robots.txt" ? robots(request) : undefined;
    },
    address(request, data, status = 200) {
      if (renderer === undefined) {
        return page(request, manifest.shell, HTML, status, ADDRESS_HEADERS);
      }
      const origin = originOf(request);
      const { language, forced } = languageOf(request);
      const rendered = renderer.module.renderAddressPage(renderer.template, {
        language,
        origin,
        pathname: request.url.pathname,
        search: request.url.search,
        data,
      });
      if (typeof rendered !== "object" || rendered === null || typeof rendered.html !== "string") {
        throw new WebBundleError("the render module did not return a page");
      }
      return html(
        request,
        withOrigin(rendered.html, origin),
        language,
        status,
        varyOn(forced, ADDRESS_HEADERS.vary),
      );
    },
    sitemap,
    notFound: (request) => page(request, manifest.notFound, HTML, 404),
  };
}
