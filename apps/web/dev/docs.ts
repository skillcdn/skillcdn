import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_PAGE_PATH, summarizeMarkdown } from "@skillcdn/core";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Plugin } from "vite";
import { createSlugger, headingText } from "../src/docs/slug.js";
import type {
  DocsCatalog,
  DocsContent,
  DocsHeading,
  DocsPage,
  DocsSection,
  DocsText,
} from "../src/docs/types.js";
import { ORIGIN_PLACEHOLDER, REPOSITORY_URL } from "../src/site-constants.js";

// The documentation of the repository, rendered into pages of the site (ADR-0049). docs/nav.json
// says which Markdown files are published, in which sections and under which slugs; this reads
// them when the pages are built, resolves every link, and hands the pages to the app as two
// virtual modules: the catalog (what there is), small enough for any page to import, and the
// content (the text of each page), which only the documentation page loads. A link that leads
// nowhere fails the build: the pages are made from the repository, so a dead link is a mistake
// in the repository, and the build is where it is caught.

export const CATALOG_MODULE = "virtual:skillcdn-docs-catalog";
export const CONTENT_MODULE = "virtual:skillcdn-docs-content";

/** The list of what is published, from the repository root. */
export const NAV_FILE = "docs/nav.json";

/** The root of this repository, which the pages document. */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where a file that is not a page is read: at the git host, on the default branch. */
const SOURCE_URL = `${REPOSITORY_URL}/blob/main/`;
const DIRECTORY_URL = `${REPOSITORY_URL}/tree/main/`;
const RAW_URL = `${REPOSITORY_URL.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/`;

const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

interface NavPage {
  readonly file: string;
  readonly slug?: string;
  readonly title?: string;
  readonly description?: string;
}

interface NavSection {
  readonly id: string;
  readonly pages: readonly NavPage[];
}

export interface LoadedDocs {
  readonly catalog: DocsCatalog;
  readonly content: DocsContent;
  /** Every file the pages were made from, as absolute paths, for whoever watches them. */
  readonly files: readonly string[];
}

/** A node of the Markdown syntax tree, as far as this file reads it. */
interface Node {
  readonly type: string;
  readonly depth?: number;
  readonly url?: string;
  readonly children?: readonly Node[];
  readonly position?: {
    readonly start: { readonly offset?: number; readonly line: number };
    readonly end: { readonly offset?: number };
  };
}

/** A span of the source text whose two outputs differ from it. */
interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly body: string;
  readonly source: string;
}

class DocsError extends Error {
  constructor(problems: readonly string[]) {
    super(`the documentation cannot be built:\n- ${problems.join("\n- ")}`);
    this.name = "DocsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, what: string, problems: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${what} must be a nonempty string`);
    return undefined;
  }
  return value;
}

/** The navigation, checked field by field: it is ours, and a mistake in it should say where. */
function readNav(root: string, problems: string[]): readonly NavSection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, NAV_FILE), "utf8"));
  } catch (error) {
    problems.push(`${NAV_FILE} cannot be read: ${error instanceof Error ? error.message : error}`);
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sections)) {
    problems.push(`${NAV_FILE} must be an object with a "sections" array`);
    return [];
  }
  const sections: NavSection[] = [];
  const ids = new Set<string>();
  parsed.sections.forEach((section: unknown, index: number) => {
    const where = `${NAV_FILE}: section ${index + 1}`;
    if (!isRecord(section) || typeof section.id !== "string" || !SECTION_ID.test(section.id)) {
      problems.push(`${where} needs an "id" of lowercase letters, digits and hyphens`);
      return;
    }
    if (ids.has(section.id)) {
      problems.push(`${where}: the id "${section.id}" is used twice`);
      return;
    }
    ids.add(section.id);
    if (!Array.isArray(section.pages) || section.pages.length === 0) {
      problems.push(`${where} ("${section.id}") needs a "pages" array with at least one page`);
      return;
    }
    const pages: NavPage[] = [];
    section.pages.forEach((page: unknown, position: number) => {
      const at = `${where} ("${section.id}"), page ${position + 1}`;
      if (!isRecord(page) || typeof page.file !== "string") {
        problems.push(`${at} needs a "file"`);
        return;
      }
      const file = page.file;
      if (
        !file.endsWith(".md") ||
        file.startsWith("/") ||
        file.includes("\\") ||
        file.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      ) {
        problems.push(`${at}: "${file}" is not a Markdown file path from the repository root`);
        return;
      }
      const slug = optionalString(page.slug, `${at}: "slug"`, problems);
      if (slug !== undefined && !SLUG.test(slug)) {
        problems.push(`${at}: the slug "${slug}" must be lowercase letters, digits and hyphens`);
        return;
      }
      pages.push({
        file,
        ...(slug === undefined ? {} : { slug }),
        ...(page.title === undefined
          ? {}
          : { title: optionalString(page.title, `${at}: "title"`, problems) }),
        ...(page.description === undefined
          ? {}
          : { description: optionalString(page.description, `${at}: "description"`, problems) }),
      });
    });
    sections.push({ id: section.id, pages });
  });
  return sections;
}

/** `docs/guide/use-skills.md` is `use-skills`; a README is named after its directory. */
function defaultSlug(file: string): string {
  const base = posix.basename(file, ".md");
  return base.toLowerCase() === "readme"
    ? posix.basename(posix.dirname(file)).toLowerCase()
    : base.toLowerCase();
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

const offsetsOf = (node: Node): readonly [number, number] | undefined =>
  node.position?.start.offset === undefined || node.position.end.offset === undefined
    ? undefined
    : [node.position.start.offset, node.position.end.offset];

/**
 * Where the destination of a link, an image or a definition sits in the source: after the last
 * `](` of a link or an image, after the `]:` of a definition, in angle brackets or up to the
 * first space, whatever title follows it.
 */
function destinationOf(
  text: string,
  node: Node,
): { readonly from: number; readonly to: number } | undefined {
  const span = offsetsOf(node);
  if (span === undefined) return undefined;
  const [start, end] = span;
  const slice = text.slice(start, end);
  const opener = node.type === "definition" ? slice.indexOf("]:") : slice.lastIndexOf("](");
  if (opener < 0) return undefined;
  let from = start + opener + 2;
  while (from < end && /\s/.test(text[from] ?? "")) from += 1;
  if (text[from] === "<") {
    const close = text.indexOf(">", from);
    return close < 0 || close >= end ? undefined : { from, to: close + 1 };
  }
  let to = from;
  while (to < end && !/[\s)]/.test(text[to] ?? "")) to += 1;
  return { from, to };
}

interface Target {
  readonly path: string;
  readonly fragment: string;
}

/**
 * The repository path a link's destination names, from the directory of the file it is written
 * in; a leading slash starts at the repository root. `undefined` when it leaves the repository.
 */
function targetOf(fromFile: string, destination: string): Target | undefined {
  const hash = destination.indexOf("#");
  const path = hash < 0 ? destination : destination.slice(0, hash);
  const fragment = hash < 0 ? "" : destination.slice(hash);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const joined = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromFile), decoded));
  const normalized = joined === "." ? "" : joined.replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    return undefined;
  }
  return { path: normalized, fragment };
}

interface Parsed {
  readonly title: string | undefined;
  readonly titleSpan: readonly [number, number] | undefined;
  /** The ids of every heading after the title, in order. */
  readonly ids: readonly string[];
  readonly headings: readonly DocsHeading[];
  readonly links: readonly { readonly node: Node; readonly url: string }[];
}

function parse(text: string): Parsed {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as unknown as Node;
  const slugger = createSlugger();
  let title: string | undefined;
  let titleSpan: readonly [number, number] | undefined;
  const ids: string[] = [];
  const headings: DocsHeading[] = [];
  const links: { node: Node; url: string }[] = [];
  walk(tree, (node) => {
    if (node.type === "heading" && typeof node.depth === "number") {
      if (node.depth === 1 && title === undefined) {
        title = headingText(node);
        titleSpan = offsetsOf(node);
        return;
      }
      const heading = headingText(node);
      const id = slugger(heading);
      ids.push(id);
      if (node.depth === 2 || node.depth === 3) {
        headings.push({ level: node.depth, text: heading, id });
      }
    }
    if (
      (node.type === "link" || node.type === "image" || node.type === "definition") &&
      typeof node.url === "string"
    ) {
      links.push({ node, url: node.url });
    }
  });
  return { title, titleSpan, ids, headings, links };
}

/** The output of a source text with its spans replaced, each by one of its two forms. */
function apply(
  text: string,
  replacements: readonly Replacement[],
  form: "body" | "source",
): string {
  let out = text;
  for (const replacement of [...replacements].sort((a, b) => b.from - a.from)) {
    out = `${out.slice(0, replacement.from)}${replacement[form]}${out.slice(replacement.to)}`;
  }
  return out;
}

/**
 * Reads the published documentation from a checkout of the repository. Throws with every problem
 * it found when the navigation, a file or a link is wrong.
 */
export function loadDocs(root: string = REPOSITORY_ROOT): LoadedDocs {
  const problems: string[] = [];
  const nav = readNav(root, problems);

  // Every page first, so that a link to another page knows its slug and its headings.
  interface Draft {
    readonly nav: NavPage;
    readonly section: string;
    readonly slug: string;
    readonly text: string;
    readonly parsed: Parsed;
  }
  const drafts: Draft[] = [];
  const slugs = new Map<string, string>();
  const byFile = new Map<string, Draft>();
  for (const section of nav) {
    for (const page of section.pages) {
      const slug = page.slug ?? defaultSlug(page.file);
      const taken = slugs.get(slug);
      if (taken !== undefined) {
        problems.push(`${page.file}: the slug "${slug}" is also the slug of ${taken}`);
        continue;
      }
      if (byFile.has(page.file)) {
        problems.push(`${page.file} is listed twice`);
        continue;
      }
      let text: string;
      try {
        text = readFileSync(join(root, ...page.file.split("/")), "utf8");
      } catch {
        problems.push(`${page.file} is listed in ${NAV_FILE} and is not a file of the repository`);
        continue;
      }
      if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
        problems.push(`${page.file} starts with front matter, which a page cannot carry`);
        continue;
      }
      const draft = { nav: page, section: section.id, slug, text, parsed: parse(text) };
      if (draft.nav.title === undefined && draft.parsed.title === undefined) {
        problems.push(`${page.file} has no level-one heading and ${NAV_FILE} gives it no title`);
        continue;
      }
      drafts.push(draft);
      slugs.set(slug, page.file);
      byFile.set(page.file, draft);
    }
  }

  const content: Record<string, DocsText> = {};
  const pages = new Map<string, DocsPage>();
  for (const draft of drafts) {
    const { nav: page, text, parsed } = draft;
    const replacements: Replacement[] = [];
    const own = new Set(parsed.ids);
    for (const { node, url } of parsed.links) {
      const line = node.position?.start.line ?? 0;
      const at = `${page.file}:${line}`;
      if (url === "") {
        problems.push(`${at}: a link with no destination`);
        continue;
      }
      if (url.startsWith("#")) {
        if (!own.has(url.slice(1))) {
          problems.push(`${at}: "${url}" names no heading of the page`);
        }
        continue;
      }
      if (HAS_SCHEME.test(url) || url.startsWith("//")) {
        continue;
      }
      const target = targetOf(page.file, url);
      const where = destinationOf(text, node);
      if (target === undefined || where === undefined) {
        problems.push(`${at}: "${url}" leaves the repository or cannot be read as a destination`);
        continue;
      }
      const published = byFile.get(target.path);
      if (node.type !== "image" && published !== undefined) {
        const fragment = target.fragment.slice(1);
        if (fragment !== "" && !published.parsed.ids.includes(fragment)) {
          problems.push(`${at}: "${url}" names no heading of ${published.nav.file}`);
          continue;
        }
        replacements.push({
          ...where,
          body: `${DOCS_PAGE_PATH}/${published.slug}${target.fragment}`,
          source: `${ORIGIN_PLACEHOLDER}${DOCS_PAGE_PATH}/${published.slug}.md${target.fragment}`,
        });
        continue;
      }
      const onDisk = join(root, ...target.path.split("/"));
      if (target.path !== "" && !existsSync(onDisk)) {
        problems.push(`${at}: "${url}" leads to nothing (${target.path})`);
        continue;
      }
      const directory = target.path === "" || statSync(onDisk).isDirectory();
      const resolved =
        node.type === "image"
          ? `${RAW_URL}${target.path}`
          : `${directory ? DIRECTORY_URL : SOURCE_URL}${target.path}${target.fragment}`;
      replacements.push({ ...where, body: resolved, source: resolved });
    }
    if (parsed.titleSpan !== undefined) {
      // The page sets the title itself; the Markdown served for agents keeps it.
      const [from, end] = parsed.titleSpan;
      let to = end;
      while (to < text.length && (text[to] === "\n" || text[to] === "\r")) to += 1;
      replacements.push({ from, to, body: "", source: text.slice(from, to) });
    }
    const summary = summarizeMarkdown(text);
    const title = page.title ?? parsed.title ?? "";
    const description = page.description ?? summary.description ?? "";
    if (description === "") {
      problems.push(`${page.file} has no paragraph to describe it by; give it a description`);
    }
    pages.set(draft.slug, {
      slug: draft.slug,
      file: page.file,
      title,
      description,
      section: draft.section,
      headings: parsed.headings,
    });
    content[draft.slug] = {
      body: apply(text, replacements, "body"),
      source: apply(text, replacements, "source"),
    };
  }

  if (problems.length > 0) {
    throw new DocsError(problems);
  }
  const sections: DocsSection[] = nav.map((section) => ({
    id: section.id,
    pages: section.pages.flatMap((page) => {
      const found = pages.get(page.slug ?? defaultSlug(page.file));
      return found === undefined ? [] : [found];
    }),
  }));
  return {
    catalog: { sections },
    content,
    files: [
      join(root, NAV_FILE),
      ...drafts.map((draft) => join(root, ...draft.nav.file.split("/"))),
    ],
  };
}

/** Serves the documentation to the pages as two virtual modules, and rebuilds them when a file changes. */
export function docsPages(): Plugin {
  let loaded: LoadedDocs | undefined;
  const docs = (): LoadedDocs => {
    loaded ??= loadDocs();
    return loaded;
  };
  const ids = new Map([
    [CATALOG_MODULE, `\0${CATALOG_MODULE}`],
    [CONTENT_MODULE, `\0${CONTENT_MODULE}`],
  ]);
  return {
    name: "skillcdn-docs-pages",
    resolveId(id) {
      return ids.get(id);
    },
    load(id) {
      if (id === ids.get(CATALOG_MODULE)) {
        for (const file of docs().files) this.addWatchFile(file);
        return `export const DOCS_CATALOG = ${JSON.stringify(docs().catalog)};\n`;
      }
      if (id === ids.get(CONTENT_MODULE)) {
        for (const file of docs().files) this.addWatchFile(file);
        return `export const DOCS_CONTENT = ${JSON.stringify(docs().content)};\n`;
      }
      return undefined;
    },
    configureServer(server) {
      // The files are outside the app, where the development server does not look by itself.
      server.watcher.add([...docs().files]);
    },
    handleHotUpdate({ file, server }) {
      if (loaded === undefined || !loaded.files.includes(resolve(file))) {
        return undefined;
      }
      loaded = undefined;
      for (const id of ids.values()) {
        const module = server.moduleGraph.getModuleById(id);
        if (module !== undefined) server.moduleGraph.invalidateModule(module);
      }
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
