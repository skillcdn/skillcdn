import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 500;
/** A title is near the top or it is not a title; this also bounds the scan. */
const MAX_LINES_SCANNED = 200;
/** Longer lines are not headings, and short lines keep the patterns below cheap on hostile input. */
const MAX_HEADING_LINE_LENGTH = 1000;

export interface MarkdownSummary {
  /** Front-matter `title`, else the first level-one heading. */
  readonly title: string | undefined;
  /** Front-matter `description`, when present. */
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

function firstHeading(body: string): string | undefined {
  let fence: string | undefined;
  let lineStart = 0;
  for (let scanned = 0; scanned < MAX_LINES_SCANNED && lineStart <= body.length; scanned += 1) {
    const lineBreak = body.indexOf("\n", lineStart);
    const line = body.slice(lineStart, lineBreak < 0 ? body.length : lineBreak).trimEnd();
    lineStart = lineBreak < 0 ? body.length + 1 : lineBreak + 1;
    if (line.length > MAX_HEADING_LINE_LENGTH) {
      continue;
    }

    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      // A fence closes with the same character, at least as long as the one that opened it.
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    const heading = /^ {0,3}#[ \t]+(.*)$/.exec(line)?.[1];
    if (heading !== undefined) {
      return shortText(heading.replace(/[ \t]+#+$/, ""), MAX_TITLE_LENGTH);
    }
  }
  return undefined;
}

/** What the index shows for a plain Markdown document. Malformed front-matter is simply not used. */
export function summarizeMarkdown(text: string): MarkdownSummary {
  const split = splitFrontMatter(text);
  if (split.kind !== "found") {
    const body = split.kind === "none" ? split.body : text;
    return { title: firstHeading(body), description: undefined, body };
  }
  const frontMatter = parseFrontMatter(split.source);
  const fields = frontMatter.ok ? frontMatter.value : undefined;
  return {
    title: shortText(fields?.get("title"), MAX_TITLE_LENGTH) ?? firstHeading(split.body),
    description: shortText(fields?.get("description"), MAX_SUMMARY_LENGTH),
    body: split.body,
  };
}
