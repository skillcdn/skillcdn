import { BLANK, consumeBlockLine, HEADING, openBlocks, plainText } from "../markdown-blocks.js";
import { hasForbiddenCodePoint } from "../text-safety.js";
import { searchLexemes } from "./lexemes.js";
import { headingPaths, type MarkdownOutline, outlineMarkdown } from "./outline.js";
import { rankSearchVector, searchVectorOf } from "./vector.js";

// The sections of a document that a search matched, named so that one `read_repo_file` call
// reads the passage (ADR-0063): the heading path, the character offset and length of the
// section, and a short excerpt around the first matching words. The same rules run in a
// deployment and in the command, over the same text, so both name the same sections.

/** A section of a document: what heads it, and the characters that read it. */
export interface DocumentSection {
  /** The heading path, outermost first; empty for the text before the first heading. */
  readonly heading: readonly string[];
  /** Where the section starts, in characters from the start of the file. */
  readonly offset: number;
  /** The characters of the section, to the next heading or the end of the file. */
  readonly length: number;
}

/** A section of a document that matched a search. */
export interface MatchedSection extends DocumentSection {
  /** A glimpse of the passage that matched, as plain text; `undefined` when the section has no prose. */
  readonly excerpt: string | undefined;
}

/**
 * The version of the rules that cut a document into sections. What is computed from a section
 * and kept, such as the vector of its meaning, is keyed by it (ADR-0064), so a change to these
 * rules is a new version here and a backfill, never a mismatch between a stored section and
 * the text it names.
 */
export const SECTIONING_VERSION = 1;

/** How many sections of one document a search result names. */
export const MAX_MATCHED_SECTIONS = 2;
/** An excerpt is a glimpse, not the passage. */
export const MAX_EXCERPT_LENGTH = 200;

/**
 * Every section of `text`, in document order: the text before the first heading when it holds
 * anything but blank lines, then the section under each heading of the outline, to the next
 * heading of any level or the end of the file. A document without headings is one section, and
 * one whose body is blank has none. Front-matter belongs to no section. The outline is computed
 * when the caller has none.
 */
export function sectionsOf(text: string, outline?: MarkdownOutline): DocumentSection[] {
  const headings = outline ?? outlineMarkdown(text);
  const sections: DocumentSection[] = [];
  const firstHeading = headings.headings[0];
  const preambleEnd = firstHeading?.offset ?? text.length;
  if (
    preambleEnd > headings.bodyOffset &&
    !BLANK.test(text.slice(headings.bodyOffset, preambleEnd))
  ) {
    sections.push({
      heading: [],
      offset: headings.bodyOffset,
      length: preambleEnd - headings.bodyOffset,
    });
  }
  const paths = headingPaths(headings.headings);
  headings.headings.forEach((heading, index) => {
    sections.push({ heading: paths[index] ?? [], offset: heading.offset, length: heading.length });
  });
  return sections;
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
  const sections = sectionsOf(text, options.outline);

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

/**
 * The text of a section without its heading line: what the section says, under the heading path
 * that names it. The text before the first heading has no heading line and is given whole.
 */
export function sectionBody(text: string, section: DocumentSection): string {
  const body = text.slice(section.offset, section.offset + section.length);
  return body.slice(headingLineLength(body, section.heading.length > 0));
}

/**
 * A section as it is embedded for the search by meaning (ADR-0064): the document's title and the
 * heading path, then the body, so that the vector carries where the passage stands as well as what
 * it says. A title that is the first heading, as a document's title usually is, is not said
 * twice. The same text is embedded wherever the vectors are made, in a deployment and by the
 * command, so that both find the same sections by the same query.
 */
export function embeddingTextOf(
  title: string | undefined,
  section: DocumentSection,
  text: string,
): string {
  const flat = (part: string): string => part.replaceAll(/\s+/g, " ").trim();
  const first = section.heading[0];
  const titled =
    title === undefined ||
    (first !== undefined && flat(first).toLowerCase() === flat(title).toLowerCase())
      ? []
      : [title];
  const head = [...titled, ...section.heading].map(flat).filter((part) => part.length > 0);
  const body = sectionBody(text, section).trim();
  if (head.length === 0) {
    return body;
  }
  return body.length === 0 ? head.join(" > ") : `${head.join(" > ")}: ${body}`;
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
