import { copyFileSync, createReadStream, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import type { Plugin } from "vite";

// The pictures of the brand are the files of `@skillcdn/brand` (ADR-0048), served by the pages at
// the addresses they always had: the icons a browser or a platform looks for at the root of the
// site, and the rest under /brand/. The development server answers them from the package, and a
// build copies them next to the pages, where the server finds them as it finds any static file.

const load = createRequire(import.meta.url);
const manifestPath = load.resolve("@skillcdn/brand/package.json");
const { exports: brandExports } = load("@skillcdn/brand/package.json") as {
  readonly exports: Readonly<Record<string, string>>;
};

/** The icons that are looked for at the root of a site: by browsers, and by the web app manifest. */
const ROOT_ICONS = new Set([
  "favicon.svg",
  "favicon.ico",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
]);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Where the pages serve each file of the brand package: the path on the site, to the file on disk. */
export const BRAND_FILES: ReadonlyMap<string, string> = new Map(
  Object.keys(brandExports)
    .filter((entry) => entry !== "./package.json")
    .map((entry) => entry.slice("./".length))
    .map((file) => [
      ROOT_ICONS.has(file) ? `/${file}` : `/brand/${file}`,
      join(dirname(manifestPath), file),
    ]),
);

/** Serves the brand files in development, and copies them into the build of the pages. */
export function brandFiles(): Plugin {
  let outDir: string | undefined;
  return {
    name: "skillcdn-brand-files",
    configResolved(config) {
      // The pages are the client build; the render module the server calls carries no files.
      outDir = config.build.ssr ? undefined : resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://pages.invalid").pathname;
        const file = BRAND_FILES.get(path);
        if (file === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
          next();
          return;
        }
        response.setHeader(
          "content-type",
          CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        );
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(file).pipe(response);
      });
    },
    writeBundle() {
      if (outDir === undefined) return;
      for (const [path, file] of BRAND_FILES) {
        const target = join(outDir, ...path.slice(1).split("/"));
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(file, target);
      }
    },
  };
}
