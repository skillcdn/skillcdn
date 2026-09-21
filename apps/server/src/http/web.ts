import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import * as z from "zod";

// Serves a build of the web UI (ADR-0009). The server knows nothing about the UI: the build
// brings a manifest that says which file answers which URL in which language, and everything
// else in the directory is a static file. A deployment without a web build simply has no UI.

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
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

/**
 * Pages render repository content, which is untrusted. Nothing inline runs, nothing loads from
 * elsewhere, and nobody frames the page.
 */
const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};

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

export interface WebBundle {
  /** A page or a file of the build, the sitemap or robots.txt. `undefined`: not ours to answer. */
  respond(request: WebRequest): Response | undefined;
  /** The frame in which the browser renders a page that depends on data, such as an address. */
  shell(request: WebRequest): Response;
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

/**
 * Reads a web build from disk, once. Pages are kept in memory because the public origin is
 * written into them per request; files are streamed from disk. Throws when the directory is
 * not a web build.
 */
export async function loadWebBundle(
  root: string,
  options: { readonly publicUrl: string | undefined },
): Promise<WebBundle> {
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

  /** Page files of the manifest, as text with placeholders. */
  const pages = new Map<string, string>();
  const pageOf = async (file: string): Promise<void> => {
    if (!pages.has(file)) {
      try {
        const template = await readFile(join(root, ...file.split("/")), "utf8");
        pages.set(file, template);
      } catch (error) {
        throw new WebBundleError(`the manifest names ${file}, which cannot be read`, {
          cause: error,
        });
      }
    }
  };
  for (const files of [manifest.shell, manifest.notFound, ...manifest.routes.map((r) => r.files)]) {
    for (const file of Object.values(files)) {
      await pageOf(file);
    }
  }

  // Everything else in the directory is a static file, except what only the manifest may serve:
  // a page under its file name would be a second URL for the same content.
  const statics = new Map<string, StaticFile>();
  for (const relative of await listFiles(root)) {
    if (relative === MANIFEST_FILE || pages.has(relative) || relative.endsWith(".html")) {
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
  const languageOf = (request: WebRequest): string => {
    const asked = request.url.searchParams.get(languageParam);
    return asked !== null && languages.includes(asked) ? asked : defaultLanguage;
  };
  const notModified = (request: WebRequest, etag: string): boolean =>
    (request.headers.get("if-none-match") ?? "")
      .split(",")
      .some((candidate) => candidate.trim() === etag);

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

  const page = (
    request: WebRequest,
    files: Record<string, string>,
    contentType: string,
    status = 200,
  ): Response => {
    const chosen = languageOf(request);
    const found = pages.get(files[chosen] ?? files[defaultLanguage] ?? "");
    if (found === undefined) {
      throw new WebBundleError("a page of the manifest was not loaded");
    }
    const origin = originOf(request);
    const body = found
      .replaceAll(originPlaceholder, origin)
      .replaceAll(hostPlaceholder, origin.replace(/^https?:\/\//, ""));
    return text(
      request,
      body,
      {
        "content-type": contentType,
        "content-language": files[chosen] === undefined ? defaultLanguage : chosen,
        // One URL, one representation: a cache may keep it, but has to ask whether it changed.
        "cache-control": "public, max-age=0, must-revalidate",
        ...(contentType === HTML ? PAGE_HEADERS : {}),
      },
      status,
    );
  };

  const urlIn = (origin: string, path: string, code: string): string =>
    code === defaultLanguage
      ? `${origin}${path}`
      : `${origin}${path}?${languageParam}=${encodeURIComponent(code)}`;

  const sitemap = (request: WebRequest): Response => {
    const origin = originOf(request);
    const entries = manifest.routes
      .filter((route) => route.indexable)
      .flatMap((route) => {
        const available = languages.filter((code) => route.files[code] !== undefined);
        const alternates = [
          ...available.map((code) => [code, urlIn(origin, route.path, code)] as const),
          ["x-default", urlIn(origin, route.path, defaultLanguage)] as const,
        ]
          .map(
            ([code, href]) =>
              `    <xhtml:link rel="alternate" hreflang="${escapeXml(code)}" href="${escapeXml(href)}"/>`,
          )
          .join("\n");
        return available.map(
          (code) =>
            `  <url>\n    <loc>${escapeXml(urlIn(origin, route.path, code))}</loc>\n${alternates}\n  </url>`,
        );
      });
    return text(
      request,
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`,
      { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
    );
  };

  // Pages of addresses are rendered in the browser and ask the API for every visitor. A crawler
  // walking them would have repositories indexed for nobody.
  const robots = (request: WebRequest): Response =>
    text(
      request,
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /gh/\n\nSitemap: ${originOf(request)}/sitemap.xml\n`,
      { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
    );

  const file = (request: WebRequest, found: StaticFile): Response => {
    const headers = {
      "content-type": found.contentType,
      "content-length": String(found.size),
      "cache-control": found.cacheControl,
      etag: found.etag,
      "x-content-type-options": "nosniff",
    };
    if (notModified(request, found.etag)) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }
    const stream = Readable.toWeb(createReadStream(found.file)) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers });
  };

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
      if (path === "/sitemap.xml") {
        return sitemap(request);
      }
      return path === "/robots.txt" ? robots(request) : undefined;
    },
    shell: (request) => page(request, manifest.shell, HTML),
    notFound: (request) => page(request, manifest.notFound, HTML, 404),
  };
}
