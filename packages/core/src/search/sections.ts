import { BLANK, consumeBlockLine, HEADING, openBlocks, plainText } from "../markdown-blocks.js";
import { hasForbiddenCodePoint } from "../text-safety.js";
import { searchLexemes } from "./lexemes.js";
import { headingPaths, type MarkdownOutline, outlineMarkdown } from "./outline.js";
import { rankSearchVector, searchVectorOf } from "./vector.js";

// The sections of a document that a search matched, named so that one `read_repo_file` call
// reads the passage (ADR-0063): the heading path, the character offset and length of the
// section, and a short excerpt around the first matching words. The same rules run in a
// deployment and in the command, over the same text, so both name the same sections.

/** A section of a document that matched a search. */
export interface MatchedSection {
  /** The heading path, outermost first; empty for the text before the first heading. */
  readonly heading: readonly string[];
  /** Where the section starts, in characters from the start of the file. */
  readonly offset: number;
  /** The characters of the section, to the next heading or the end of the file. */
  readonly length: number;
  /** A glimpse of the passage that matched, as plain text; `undefined` when the section has no prose. */
  readonly excerpt: string | undefined;
}

/** How many sections of one document a search result names. */
export const MAX_MATCHED_SECTIONS = 2;
/** An excerpt is a glimpse, not the passage. */
export const MAX_EXCERPT_LENGTH = 200;

interface Section {
  readonly heading: readonly string[];
  readonly offset: number;
  readonly length: number;
}

/** A line as an excerpt shows it: plain, on one line, and safe to display. */
function flatten(line: string): string {
  const text = plainText(line).replaceAll(/\s+/g, " ").trim();
  return hasForbiddenCodePoint(text) ? "" : text;
}

const cut = (text: string, length: number): string =>
  text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;

/**
 * An excerpt of one line: the line when it is short, else the window of its words that holds
 * the most of the words searched for, the earliest among equals, marked at the ends it was cut.
 */
function excerptOfLine(line: string, matched: (text: string) => number): string {
  const flat = flatten(line);
  if (flat.length <= MAX_EXCERPT_LENGTH) {
    return flat;
  }
  const words = flat.split(" ");
  let best: { readonly text: string; readonly count: number } | undefined;
  let start = 0;
  while (start < words.length) {
    let end = start;
    let length = 0;
    while (end < words.length && length + (words[end]?.length ?? 0) + 1 <= MAX_EXCERPT_LENGTH - 2) {
      length += (words[end]?.length ?? 0) + 1;
      end += 1;
    }
    if (end === start) {
      end = start + 1;
    }
    const window = words.slice(start, end).join(" ");
    const count = matched(window);
    if (count > 0 && (best === undefined || count > best.count)) {
      best = {
        text: `${start > 0 ? "…" : ""}${cut(window, MAX_EXCERPT_LENGTH - 2)}${end < words.length ? "…" : ""}`,
        count,
      };
    }
    // Half a window on, so that a match split between two windows is still met.
    start = Math.max(start + 1, Math.floor((start + end) / 2));
  }
  return best?.text ?? cut(flat, MAX_EXCERPT_LENGTH);
}

/**
 * The excerpt of a section: the line of prose that holds the most of the words searched for,
 * the earliest among equals, else the first line of prose, else nothing. Code, HTML blocks and
 * headings are not prose.
 */
function excerptOf(section: string, matched: (text: string) => number): string | undefined {
  const blocks = openBlocks();
  let first: string | undefined;
  let best: { readonly line: string; readonly count: number } | undefined;
  let lineStart = 0;
  while (lineStart <= section.length) {
    const lineBreak = section.indexOf("\n", lineStart);
    const line = section.slice(lineStart, lineBreak < 0 ? section.length : lineBreak).trimEnd();
    lineStart = lineBreak < 0 ? section.length + 1 : lineBreak + 1;
    const head = line.slice(0, 1000);
    if (consumeBlockLine(blocks, head) || BLANK.test(head) || HEADING.test(head)) {
      continue;
    }
    const count = matched(line);
    if (count > 0 && (best === undefined || count > best.count)) {
      best = { line, count };
    }
    if (first === undefined) {
      const flat = flatten(line);
      if (flat.length > 0) {
        first = cut(flat, MAX_EXCERPT_LENGTH);
      }
    }
  }
  return best === undefined ? first : excerptOfLine(best.line, matched);
}

/**
 * The sections of `text` that the lexemes of a query match, best first, at most `limit` of
 * them: each heading's section is ranked by its heading path and its own text, with the word
 * rules of `language`, as the documents themselves are ranked. The text before the first
 * heading is a section of its own when it holds prose; a document without headings is one
 * section. Empty when nothing matches.
 */
export function matchSections(
  text: string,
  lexemes: readonly string[],
  options: {
    readonly language?: string | undefined;
    readonly limit?: number | undefined;
    readonly outline?: MarkdownOutline | undefined;
  } = {},
): MatchedSection[] {
  if (lexemes.length === 0) {
    return [];
  }
  const outline = options.outline ?? outlineMarkdown(text);
  const sections: Section[] = [];
  const firstHeading = outline.headings[0];
  const preambleEnd = firstHeading?.offset ?? text.length;
  if (
    preambleEnd > outline.bodyOffset &&
    !BLANK.test(text.slice(outline.bodyOffset, preambleEnd))
  ) {
    sections.push({
      heading: [],
      offset: outline.bodyOffset,
      length: preambleEnd - outline.bodyOffset,
    });
  }
  const paths = headingPaths(outline.headings);
  outline.headings.forEach((heading, index) => {
    sections.push({ heading: paths[index] ?? [], offset: heading.offset, length: heading.length });
  });

  const wanted = new Set(lexemes);
  /** How many of the words searched for a text holds, each counted once. */
  const matched = (candidate: string): number =>
    new Set(
      searchLexemes(candidate, options.language)
        .map((lexeme) => lexeme.lexeme)
        .filter((lexeme) => wanted.has(lexeme)),
    ).size;
  // A section is ranked like a document: its own heading as the name, the headings above it as
  // the words of a path, and its text as the body, so that a section does not outrank its parent
  // on the parent's heading alone.
  const ranked = sections
    .map((section) => {
      const body = text.slice(section.offset, section.offset + section.length);
      const vector = searchVectorOf(
        [
          { weight: "A", text: section.heading[section.heading.length - 1] ?? "" },
          { weight: "C", text: section.heading.slice(0, -1).join(" ") },
          { weight: "D", text: body },
        ],
        options.language,
      );
      return { section, body, rank: rankSearchVector(vector, lexemes) };
    })
    .filter((item) => item.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.section.offset - b.section.offset)
    .slice(0, options.limit ?? MAX_MATCHED_SECTIONS);
  return ranked.map(({ section, body }) => ({
    heading: section.heading,
    offset: section.offset,
    length: section.length,
    // The heading's own line is the section's name, not its prose: a setext heading takes two.
    excerpt: excerptOf(body.slice(headingLineLength(body, section.heading.length > 0)), matched),
  }));
}

/** The characters of the heading at the start of a section: one line, two for a setext heading, none for a preamble. */
function headingLineLength(body: string, headed: boolean): number {
  if (!headed) {
    return 0;
  }
  const firstBreak = body.indexOf("\n");
  const firstLine = firstBreak < 0 ? body : body.slice(0, firstBreak);
  if (HEADING.test(firstLine) || firstBreak < 0) {
    return firstBreak < 0 ? body.length : firstBreak + 1;
  }
  const secondBreak = body.indexOf("\n", firstBreak + 1);
  return secondBreak < 0 ? body.length : secondBreak + 1;
}
