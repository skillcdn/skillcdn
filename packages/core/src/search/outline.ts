import { splitFrontMatter } from "../front-matter.js";
import {
  BLANK,
  consumeBlockLine,
  EMPTY_HEADING,
  HEADING,
  MAX_HEADING_LINE_LENGTH,
  openBlocks,
  plainText,
} from "../markdown-blocks.js";
import { hasForbiddenCodePoint } from "../text-safety.js";

// The outline of a Markdown document: its headings, each with the character offset of its line
// and the length of its section, so that a long document is walked by its structure and a section
// read with one `read_repo_file` call (ADR-0063). Offsets count characters of the file as it is
// read, front-matter included, which is what the read takes.

/** One heading of a document and the section under it. */
export interface OutlineHeading {
  /** 1 to 6. */
  readonly level: number;
  /** The heading as plain text, markup stripped; empty when the heading has no usable text. */
  readonly text: string;
  /** Where the heading's line starts, in characters from the start of the file. */
  readonly offset: number;
  /** The characters from there to the next heading of any level, or to the end of the file. */
  readonly length: number;
}

export interface MarkdownOutline {
  /** The headings in document order. */
  readonly headings: readonly OutlineHeading[];
  /** Where the body starts: after the front-matter, when the document has one. */
  readonly bodyOffset: number;
  /** The characters of the whole file. */
  readonly totalLength: number;
  /** True when the document has more headings than were kept. */
  readonly truncated: boolean;
}

/** How many headings an outline keeps; a document with more is cut, and says so. */
export const MAX_OUTLINE_HEADINGS = 1000;
const MAX_HEADING_TEXT_LENGTH = 200;

/** A line of `=` under a paragraph makes it a level-one heading; a line of `-`, a level-two one. */
const SETEXT_ONE = /^ {0,3}=+[ \t]*$/;
const SETEXT_TWO = /^ {0,3}-+[ \t]*$/;
/** Lines that are not paragraph text, so an underline after them is not a heading. */
const NOT_PARAGRAPH = /^ {0,3}(?:[>|]|[-*+][ \t]|\d{1,9}[.)][ \t]|(?:[-*_][ \t]*){3,}$)/;

/** A heading's text as the outline shows it: plain, on one line, bounded, and safe to display. */
function headingText(raw: string): string {
  const text = plainText(raw.replace(/[ \t]+#+$/, ""))
    .replaceAll(/\s+/g, " ")
    .trim();
  if (text.length === 0 || hasForbiddenCodePoint(text)) {
    return "";
  }
  return text.slice(0, MAX_HEADING_TEXT_LENGTH);
}

/**
 * The outline of a document: every ATX heading (`## Title`) and setext heading (a paragraph
 * underlined with `===` or `---`) outside fenced code and HTML blocks, with its offset and the
 * length of its section. Total: any text yields an outline, and the work is linear in the text.
 */
export function outlineMarkdown(text: string): MarkdownOutline {
  const split = splitFrontMatter(text);
  // The body is the tail of the text, so where it starts is what the front-matter took.
  const bodyOffset = split.kind === "found" ? text.length - split.body.length : 0;
  const found: { level: number; text: string; offset: number }[] = [];
  const blocks = openBlocks();
  /** The paragraph an underline would turn into a heading: where it starts and its lines. */
  let paragraphStart: number | undefined;
  let paragraphLines: string[] = [];
  const endParagraph = (): void => {
    paragraphStart = undefined;
    paragraphLines = [];
  };

  let lineStart = bodyOffset;
  while (lineStart <= text.length) {
    const lineBreak = text.indexOf("\n", lineStart);
    const lineEnd = lineBreak < 0 ? text.length : lineBreak;
    const line = text.slice(lineStart, lineEnd).trimEnd();
    const head = line.slice(0, MAX_HEADING_LINE_LENGTH);
    const next = lineBreak < 0 ? text.length + 1 : lineBreak + 1;

    if (consumeBlockLine(blocks, head)) {
      endParagraph();
    } else if (BLANK.test(head)) {
      endParagraph();
    } else if (line.length <= MAX_HEADING_LINE_LENGTH && HEADING.test(line)) {
      const match = HEADING.exec(line);
      endParagraph();
      found.push({
        level: match?.[1]?.length ?? 1,
        text: headingText(match?.[2] ?? ""),
        offset: lineStart,
      });
    } else if (line.length <= MAX_HEADING_LINE_LENGTH && EMPTY_HEADING.test(line)) {
      endParagraph();
      found.push({
        level: EMPTY_HEADING.exec(line)?.[1]?.length ?? 1,
        text: "",
        offset: lineStart,
      });
    } else if (paragraphStart !== undefined && (SETEXT_ONE.test(head) || SETEXT_TWO.test(head))) {
      found.push({
        level: SETEXT_ONE.test(head) ? 1 : 2,
        text: headingText(paragraphLines.join(" ")),
        offset: paragraphStart,
      });
      endParagraph();
    } else if (NOT_PARAGRAPH.test(head)) {
      endParagraph();
    } else {
      if (paragraphStart === undefined) {
        paragraphStart = lineStart;
      }
      paragraphLines.push(head);
    }
    lineStart = next;
  }

  const truncated = found.length > MAX_OUTLINE_HEADINGS;
  const headings: OutlineHeading[] = found.slice(0, MAX_OUTLINE_HEADINGS).map((heading, index) => ({
    level: heading.level,
    text: heading.text,
    offset: heading.offset,
    length: (found[index + 1]?.offset ?? text.length) - heading.offset,
  }));
  return { headings, bodyOffset, totalLength: text.length, truncated };
}

/**
 * The heading path of each heading: the heading itself after every ancestor, the nearest heading
 * above it with a smaller level and so on up. A heading without text contributes nothing to a
 * path but its place.
 */
export function headingPaths(headings: readonly OutlineHeading[]): string[][] {
  const paths: string[][] = [];
  const stack: { level: number; text: string }[] = [];
  for (const heading of headings) {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    stack.push({ level: heading.level, text: heading.text });
    paths.push(stack.map((item) => item.text).filter((text) => text.length > 0));
  }
  return paths;
}
