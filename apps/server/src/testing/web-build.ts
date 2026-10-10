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
    // A page of the documentation: the frame in every language around a text in one (ADR-0049).
    {
      path: "/docs/format",
      files: { en: "docs/format/index.html", ko: "docs/format/index.ko.html" },
      indexable: true,
      alternates: ["en"],
    },
    {
      path: "/docs/format.md",
      files: { en: "docs/format.md" },
      indexable: false,
      contentType: "text/markdown; charset=utf-8",
    },
  ],
  shell: { en: "shell.html", ko: "shell.ko.html" },
  notFound: { en: "not-found.html", ko: "not-found.ko.html" },
};

export const RENDER_MODULE = "render/entry-server.js";
export const TEMPLATE_FILE = "template.html";

/**
 * A render module as the UI would build it, reduced to what a test can read back: the page
 * repeats the input it was rendered with, and says it is indexable when the index was there.
 * The front page and llms.txt repeat the showcase they were rendered with.
 */
const RENDER_MODULE_SOURCE = `
export function renderAddressPage(template, input) {
  const json = JSON.stringify(input).replaceAll("<", "\\\\u003c");
  const ready = input.data.mount !== undefined && input.data.mount.ready !== undefined;
  const html = template
    .replace('<html lang="en">', '<html lang="' + input.language + '">')
    .replace("<!--app-html-->", '<pre id="input">' + json + "</pre>")
    .replace("<!--app-head-->", "<title>Rendered " + input.pathname + "</title>");
  return { html, indexable: ready && input.data.mount.ready.index.status === "ready" };
}
export function renderLandingPage(template, input) {
  const json = JSON.stringify(input).replaceAll("<", "\\\\u003c");
  const html = template
    .replace('<html lang="en">', '<html lang="' + input.language + '">')
    .replace("<!--app-html-->", '<pre id="input">' + json + "</pre>")
    .replace("<!--app-head-->", "<title>Rendered front page</title>");
  return { html, indexable: true };
}
export function renderLlmsTxt(language, showcase) {
  return "# Site in " + language + "\\n\\n" + JSON.stringify(showcase) + "\\n";
}
export function renderLegalPage(template, input) {
  const json = JSON.stringify(input).replaceAll("<", "\\\\u003c");
  const html = template
    .replace('<html lang="en">', '<html lang="' + input.language + '">')
    .replace("<!--app-html-->", '<pre id="input">' + json + "</pre>")
    .replace("<!--app-head-->", "<title>Rendered " + input.pathname + "</title>");
  return { html, indexable: input.data.legal.ready !== undefined };
}
export function socialCard(language, origin, data) {
  const mount = data.mount;
  const skill = data.skill !== undefined && data.skill.status === "ready" ? data.skill.skill : undefined;
  return {
    kicker: skill === undefined ? "Repository" : "Skill",
    title: skill === undefined ? mount.repository.owner + "/" + mount.repository.name : skill.name,
    subtitle: origin.replace(/^https?:\\/\\//, "") + mount.address + " (" + language + ")",
    description: (skill === undefined ? mount.repository.description : skill.description) ?? "",
    badges: mount.index.status === "ready" ? [mount.index.skillCount + " skills"] : [],
    verified: mount.verified,
    avatar: mount.repository.avatar,
    siteName: "SkillCDN",
  };
}
export function docsSocialCard(language, origin, slug) {
  if (slug !== "" && slug !== "format") return undefined;
  return {
    kicker: slug === "" ? "SkillCDN" : "Documentation",
    title: slug === "" ? "Documentation" : "The format",
    subtitle: origin.replace(/^https?:\\/\\//, "") + "/docs" + (slug === "" ? "" : "/" + slug) + " (" + language + ")",
    description: "What a page says.",
    badges: slug === "" ? [] : ["Reference"],
    verified: false,
    avatar: "",
    siteName: "SkillCDN",
  };
}
`;

const TEMPLATE_SOURCE =
  '<!doctype html><html lang="en"><head><!--app-head-->' +
  `<meta name="skillcdn-origin" content="${ORIGIN_PLACEHOLDER}"></head>` +
  '<body><div id="root"><!--app-html--></div></body></html>';

export interface WebBuildFixture {
  readonly root: string;
  write(file: string, content: string): void;
  remove(): void;
}

export interface WebBuildOptions {
  /** Whether the build brings a render module for address pages. Default: it does. */
  readonly render?: boolean;
}

export function createWebBuild(
  manifest: unknown = WEB_BUILD_MANIFEST,
  options: WebBuildOptions = {},
): WebBuildFixture {
  const root = mkdtempSync(join(tmpdir(), "skillcdn-web-"));
  const write = (file: string, content: string): void => {
    const target = join(root, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const render = options.render ?? true;
  write(
    "routes.json",
    JSON.stringify(
      render && typeof manifest === "object" && manifest !== null
        ? { ...manifest, render: RENDER_MODULE, template: TEMPLATE_FILE }
        : manifest,
    ),
  );
  if (render) {
    write(RENDER_MODULE, RENDER_MODULE_SOURCE);
    write(TEMPLATE_FILE, TEMPLATE_SOURCE);
  }
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
  write("docs/format/index.html", page("en", "The format"));
  write("docs/format/index.ko.html", page("ko", "The format, framed in Korean"));
  write(
    "docs/format.md",
    `# The format\n\nRead [the tools](${ORIGIN_PLACEHOLDER}/docs/tools.md).\n`,
  );
  write("assets/index-abc123.js", "console.log('bundle');\n");
  write("favicon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>\n");
  write("showcase/clip.mp4", "not a video, but served like one\n");
  return { root, write, remove: () => rmSync(root, { recursive: true, force: true }) };
}
