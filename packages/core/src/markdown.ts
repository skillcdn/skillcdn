import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import {
  BLANK,
  consumeBlockLine,
  HEADING,
  MAX_HEADING_LINE_LENGTH,
  openBlocks,
  plainText,
} from "./markdown-blocks.js";
import { parentDirectory } from "./repo-layout.js";
import { type RepoPath, resolveRepoPath } from "./repo-path.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 500;
/** A summary taken from the body is a glimpse, not the document. */
const MAX_SNIPPET_LENGTH = 200;
/**
 * How much of a paragraph the glimpse is taken from. Stripping markup can shorten text, so more
 * than the snippet is read, but not the whole paragraph: the patterns below cost quadratic time
 * on a paragraph made of brackets that never close.
 */
const MAX_SNIPPET_SOURCE_LENGTH = 4096;
/** A title and an introduction are near the top or they are not that; this also bounds the scan. */
const MAX_LINES_SCANNED = 200;

export interface MarkdownSummary {
  /** Front-matter `title`, else the first level-one heading. */
  readonly title: string | undefined;
  /**
   * Front-matter `description`, else the first paragraph after the title (or the first paragraph
   * of the document when it has no title), shortened.
   */
  readonly description: string | undefined;
  /** The document without its front-matter. */
  readonly body: string;
}

function shortText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.replaceAll(/\s+/g, " ").trim();
  if (text.length === 0 || hasForbiddenCodePoint(text)) {
    return undefined;
  }
  return text.slice(0, maxLength);
}

/** Lines that are markup rather than prose: they end a paragraph and never start one. */
const NOT_PROSE =
  /^ {0,3}(?:[>|!]|[-*+][ \t]|\d{1,9}[.)][ \t]|\[!\[|\[[^\]]+\]:|(?:[-*_][ \t]*){3,}$)/;

/** What the top of a document says about itself: its title and its first paragraph of prose. */
function scanTop(body: string): { readonly title?: string; readonly paragraph?: string } {
  const blocks = openBlocks();
  let title: string | undefined;
  let beforeTitle: string | undefined;
  let afterTitle: string | undefined;
  let lines: string[] = [];
  const endParagraph = (): void => {
    if (lines.length > 0) {
      const text = lines.join(" ");
      if (title === undefined) {
        beforeTitle ??= text;
      } else {
        afterTitle ??= text;
      }
      lines = [];
    }
  };

  let lineStart = 0;
  for (let scanned = 0; scanned < MAX_LINES_SCANNED && lineStart <= body.length; scanned += 1) {
    const lineBreak = body.indexOf("\n", lineStart);
    const line = body.slice(lineStart, lineBreak < 0 ? body.length : lineBreak).trimEnd();
    lineStart = lineBreak < 0 ? body.length + 1 : lineBreak + 1;
    if (afterTitle !== undefined) {
      break;
    }
    // Patterns only ever see the head of a line; the rest of a long line is prose or nothing.
    const head = line.slice(0, MAX_HEADING_LINE_LENGTH);

    // A fence, an HTML block and what is inside them are markup: a paragraph ends there, and a
    // picture or a paragraph inside a centred `<div>` is not the introduction.
    if (consumeBlockLine(blocks, head)) {
      endParagraph();
      continue;
    }
    const heading = line.length <= MAX_HEADING_LINE_LENGTH ? HEADING.exec(line) : null;
    if (heading !== null) {
      endParagraph();
      if (title === undefined && heading[1] === "#") {
        title = shortText(heading[2]?.replace(/[ \t]+#+$/, ""), MAX_TITLE_LENGTH);
        if (title === undefined) {
          // An unusable level-one heading is still where the introduction starts.
          title = "";
        }
      }
      continue;
    }
    if (BLANK.test(head) || NOT_PROSE.test(head)) {
      endParagraph();
      continue;
    }
    lines.push(head);
  }
  endParagraph();
  return {
    ...(title === undefined || title.length === 0 ? {} : { title }),
    ...((title === undefined ? beforeTitle : afterTitle) === undefined
      ? {}
      : { paragraph: title === undefined ? beforeTitle : afterTitle }),
  };
}

function snippet(paragraph: string | undefined): string | undefined {
  const text = shortText(
    paragraph === undefined ? undefined : plainText(paragraph.slice(0, MAX_SNIPPET_SOURCE_LENGTH)),
    Infinity,
  );
  if (text === undefined) {
    return undefined;
  }
  return text.length <= MAX_SNIPPET_LENGTH
    ? text
    : `${text.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

/** What the index shows for a plain Markdown document. Malformed front-matter is simply not used. */
export function summarizeMarkdown(text: string): MarkdownSummary {
  const split = splitFrontMatter(text);
  if (split.kind !== "found") {
    const body = split.kind === "none" ? split.body : text;
    const top = scanTop(body);
    return { title: top.title, description: snippet(top.paragraph), body };
  }
  const frontMatter = parseFrontMatter(split.source);
  const fields = frontMatter.ok ? frontMatter.value : undefined;
  const top = scanTop(split.body);
  return {
    title: shortText(fields?.get("title"), MAX_TITLE_LENGTH) ?? top.title,
    description:
      shortText(fields?.get("description"), MAX_SUMMARY_LENGTH) ?? snippet(top.paragraph),
    body: split.body,
  };
}

/** How many originals a document names in its front-matter `source`, and how long each may be. */
const MAX_DOCUMENT_SOURCES = 8;
const MAX_SOURCE_LENGTH = 300;

/**
 * What a document says it was made from (ADR-0076): the front-matter `source`, one value or a
 * list of them. A value is the path of the original in the repository, written as a link is,
 * relative to the document or from the root, or any other text, such as a title or a URL, which
 * is kept as written. Malformed front-matter, and any other key, names nothing.
 */
export function documentSources(text: string): string[] {
  const split = splitFrontMatter(text);
  if (split.kind !== "found") {
    return [];
  }
  const parsed = parseFrontMatter(split.source);
  if (!parsed.ok) {
    return [];
  }
  const value = parsed.value.get("source");
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => {
      const source = shortText(item, MAX_SOURCE_LENGTH);
      return source === undefined ? [] : [source];
    })
    .slice(0, MAX_DOCUMENT_SOURCES);
}

/**
 * The file of the repository a `source` names, when it names one: a path as a link destination
 * is written, resolved from the document; `undefined` for a URL, an anchor or a path that leaves
 * the repository, which stay text.
 */
export function resolveDocumentSource(document: RepoPath, source: string): RepoPath | undefined {
  if (source.startsWith("#") || source.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(source)) {
    return undefined;
  }
  return resolveRepoPath(parentDirectory(document), source);
}
