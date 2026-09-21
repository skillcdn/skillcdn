// The last step of the build. Renders every static page once per language into dist/, plus the
// shell for pages that render in the browser, llms.txt, and routes.json: the manifest that tells
// whatever serves dist/ which file answers which URL in which language (ADR-0009).
//
// Pages carry a placeholder instead of the public origin; the server fills it in. For a plain
// static host, set SKILLCDN_PUBLIC_URL when building and the origin is written into the files.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ssr = join(root, "dist-ssr");

const {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  ORIGIN_PLACEHOLDER,
  STATIC_PAGES,
  renderLlmsTxt,
  renderNotFound,
  renderPage,
  renderShell,
} = await import(pathToFileURL(join(ssr, "entry-server.js")).href);

const template = readFileSync(join(dist, "index.html"), "utf8");
for (const marker of [
  '<html lang="en">',
  "<!--app-head-->",
  '<div id="root"><!--app-html--></div>',
]) {
  if (!template.includes(marker)) {
    throw new Error(`index.html lost the marker ${marker}`);
  }
}

// biome-ignore lint/style/noProcessEnv: a build script; there is no config module to go through
const publicUrl = process.env.SKILLCDN_PUBLIC_URL?.replace(/\/+$/, "");
const withOrigin = (text) =>
  publicUrl === undefined || publicUrl === ""
    ? text
    : text
        .replaceAll(ORIGIN_PLACEHOLDER, publicUrl)
        .replaceAll(
          ORIGIN_PLACEHOLDER.replace(/^https?:\/\//, ""),
          publicUrl.replace(/^https?:\/\//, ""),
        );

const suffixOf = (language) => (language === DEFAULT_LANGUAGE ? "" : `.${language}`);

function write(file, content) {
  const target = join(dist, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, withOrigin(content));
}

function writePage(file, page) {
  write(
    file,
    template
      .replace('<html lang="en">', `<html lang="${page.htmlLang}">`)
      .replace("<!--app-head-->", page.head)
      .replace(
        '<div id="root"><!--app-html--></div>',
        `<div id="root" data-prerendered="${page.routeName}">${page.body}</div>`,
      ),
  );
}

const byLanguage = (fileOf) =>
  Object.fromEntries(LANGUAGES.map((language) => [language, fileOf(language)]));

const routes = [];
for (const page of STATIC_PAGES) {
  const files = byLanguage((language) => `${page.file}${suffixOf(language)}.html`);
  for (const language of LANGUAGES) {
    writePage(files[language], renderPage(page.path, language));
  }
  routes.push({ path: page.path, files, indexable: page.indexable });
}

const llms = byLanguage((language) => `llms${suffixOf(language)}.txt`);
for (const language of LANGUAGES) {
  write(llms[language], renderLlmsTxt(language));
}
routes.push({
  path: "/llms.txt",
  files: llms,
  indexable: false,
  contentType: "text/plain; charset=utf-8",
});

const shell = byLanguage((language) => `shell${suffixOf(language)}.html`);
const notFound = byLanguage((language) => `not-found${suffixOf(language)}.html`);
for (const language of LANGUAGES) {
  writePage(shell[language], renderShell(language));
  writePage(notFound[language], renderNotFound(language));
}
// What static hosts serve for unknown paths: the shell, so that deep links still open.
cpSync(join(dist, shell[DEFAULT_LANGUAGE]), join(dist, "404.html"));

write(
  "routes.json",
  `${JSON.stringify(
    {
      version: 1,
      defaultLanguage: DEFAULT_LANGUAGE,
      languages: LANGUAGES,
      routes,
      shell,
      notFound,
    },
    null,
    2,
  )}\n`,
);

rmSync(ssr, { recursive: true, force: true });
process.stdout.write(
  `prerendered ${routes.length} routes in ${LANGUAGES.length} languages (${LANGUAGES.join(", ")})\n`,
);
