import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Test support: a directory that looks like a build of the web UI, small enough to read here.
// The real build lives in another workspace, which the server must not depend on.

export const ORIGIN_PLACEHOLDER = "https://origin.placeholder.invalid";

const page = (language: string, title: string): string =>
  `<!doctype html><html lang="${language}"><head><title>${title}</title>` +
  `<link rel="canonical" href="${ORIGIN_PLACEHOLDER}/"></head>` +
  `<body><code>${ORIGIN_PLACEHOLDER.replace("https://", "")}/gh/owner/repo</code></body></html>`;

export const WEB_BUILD_MANIFEST = {
  version: 1,
  defaultLanguage: "en",
  languages: ["en", "ko"],
  languageParam: "lang",
  originPlaceholder: ORIGIN_PLACEHOLDER,
  routes: [
    { path: "/", files: { en: "index.html", ko: "index.ko.html" }, indexable: true },
    {
      path: "/explore",
      files: { en: "explore/index.html", ko: "explore/index.ko.html" },
      indexable: true,
    },
    {
      path: "/llms.txt",
      files: { en: "llms.txt" },
      indexable: false,
      contentType: "text/plain; charset=utf-8",
    },
  ],
  shell: { en: "shell.html", ko: "shell.ko.html" },
  notFound: { en: "not-found.html", ko: "not-found.ko.html" },
};

export interface WebBuildFixture {
  readonly root: string;
  write(file: string, content: string): void;
  remove(): void;
}

export function createWebBuild(manifest: unknown = WEB_BUILD_MANIFEST): WebBuildFixture {
  const root = mkdtempSync(join(tmpdir(), "skillcdn-web-"));
  const write = (file: string, content: string): void => {
    const target = join(root, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write("routes.json", JSON.stringify(manifest));
  write("index.html", page("en", "Front page"));
  write("index.ko.html", page("ko", "Front page in Korean"));
  write("explore/index.html", page("en", "Explore"));
  write("explore/index.ko.html", page("ko", "Explore in Korean"));
  write("shell.html", page("en", "Shell"));
  write("shell.ko.html", page("ko", "Shell in Korean"));
  write("not-found.html", page("en", "Not found"));
  write("not-found.ko.html", page("ko", "Not found in Korean"));
  write("404.html", page("en", "Shell"));
  write("llms.txt", `# Site\n\n${ORIGIN_PLACEHOLDER}/gh/owner/repo\n`);
  write("assets/index-abc123.js", "console.log('bundle');\n");
  write("favicon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>\n");
  return { root, write, remove: () => rmSync(root, { recursive: true, force: true }) };
}
