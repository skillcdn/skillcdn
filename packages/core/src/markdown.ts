import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 500;
/** A summary taken from the body is a glimpse, not the document. */
const MAX_SNIPPET_LENGTH = 200;
/** A title and an introduction are near the top or they are not that; this also bounds the scan. */
const MAX_LINES_SCANNED = 200;
/** Longer lines are not headings, and short lines keep the patterns below cheap on hostile input. */
const MAX_HEADING_LINE_LENGTH = 1000;

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

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** Lines that are markup rather than prose: they end a paragraph and never start one. */
const NOT_PROSE =
  /^ {0,3}(?:[<>|!]|[-*+][ \t]|\d{1,9}[.)][ \t]|\[!\[|\[[^\]]+\]:|(?:[-*_][ \t]*){3,}$)/;

/** What the top of a document says about itself: its title and its first paragraph of prose. */
function scanTop(body: string): { readonly title?: string; readonly paragraph?: string } {
  let fence: string | undefined;
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

    const marker = FENCE.exec(head)?.[1];
    if (fence !== undefined) {
      // A fence closes with the same character, at least as long as the one that opened it.
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (marker !== undefined) {
      endParagraph();
      fence = marker;
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
    if (head.trim().length === 0 || NOT_PROSE.test(head)) {
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

/** Inline markup that gets in the way of a one-line glimpse: links become their text. */
function plainText(markdown: string): string {
  return markdown
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/[`*]+/g, "")
    .replaceAll(/(?<!\w)_+|_+(?!\w)/g, "");
}

function snippet(paragraph: string | undefined): string | undefined {
  const text = shortText(paragraph === undefined ? undefined : plainText(paragraph), Infinity);
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
