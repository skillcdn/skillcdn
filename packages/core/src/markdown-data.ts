import { splitFrontMatter } from "./front-matter.js";
import {
  BLANK,
  consumeBlockLine,
  FENCE,
  HEADING,
  MAX_HEADING_LINE_LENGTH,
  openBlocks,
} from "./markdown-blocks.js";

// The tables and the fenced code blocks of a Markdown document as data (ADR-0080): what a table
// holds row by row under the names of its columns, and what a block holds line by line, so that
// a program takes them from where they stand instead of a model copying them out. Total and
// linear in the text: a document that is not Markdown has neither, and nothing here is a pattern
// that reads a line twice.

/** A table of a document: a header row, a delimiter row under it, and the rows that follow. */
export interface MarkdownTable {
  /** Where the header row starts, in characters from the start of the file. */
  readonly offset: number;
  /** The cells of the header row, as written. */
  readonly columns: readonly string[];
  /** The rows, each as many cells as the header has: a short row is filled up, a long one cut. */
  readonly rows: readonly (readonly string[])[];
}

/** A fenced code block of a document. */
export interface MarkdownCodeBlock {
  /** Where the line of the opening fence starts, in characters from the start of the file. */
  readonly offset: number;
  /** The first word after the opening fence, what the block says it is written in; empty when it says nothing. */
  readonly language: string;
  /** The lines between the fences, without the indentation of the opening fence. */
  readonly text: string;
}

export interface MarkdownData {
  readonly tables: readonly MarkdownTable[];
  readonly code: readonly MarkdownCodeBlock[];
}

/** A table of more columns than this keeps the first of them. */
export const MAX_TABLE_COLUMNS = 64;

/** A cell of a delimiter row: hyphens, with a colon at either end for the alignment. */
const DELIMITER_CELL = /^:?-+:?$/;
/** A line that begins another block ends a table: a quote, a list item, a thematic break. */
const OTHER_BLOCK = /^ {0,3}(?:>|[-*+][ \t]|\d{1,9}[.)][ \t]|(?:[-*_][ \t]*){3,}$)/;
/** Indented four or more: code, where a pipe is a character like any other. */
const INDENTED = /^(?: {4}|\t)/;

/**
 * The cells of a table row: the text between the pipes that are not escaped, trimmed, with an
 * escaped pipe as the pipe it stands for; the pipes at the two ends open and close the row and
 * hold nothing. At most {@link MAX_TABLE_COLUMNS} cells.
 */
function cellsOf(line: string): string[] {
  const text = line.trim();
  const cells: string[] = [];
  let parts: string[] = [];
  let from = text.startsWith("|") ? 1 : 0;
  let closed = false;
  for (let at = from; at < text.length; at += 1) {
    const character = text[at];
    if (character === "\\" && text[at + 1] === "|") {
      parts.push(text.slice(from, at), "|");
      at += 1;
      from = at + 1;
      continue;
    }
    if (character === "|") {
      parts.push(text.slice(from, at));
      cells.push(parts.join("").trim());
      parts = [];
      from = at + 1;
      closed = from === text.length;
      if (cells.length >= MAX_TABLE_COLUMNS) {
        return cells;
      }
    }
  }
  if (!closed) {
    parts.push(text.slice(from));
    cells.push(parts.join("").trim());
  }
  return cells;
}

/** Whether a line can be a row of a table: it holds a pipe, and is not indented as code is. */
const isRow = (line: string): boolean => line.includes("|") && !INDENTED.test(line);

/** The cells of a delimiter row, `| --- | :-: |`, or nothing when the line is none. */
function delimiterOf(line: string): string[] | undefined {
  if (!line.includes("-") || INDENTED.test(line)) {
    return undefined;
  }
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell)) ? cells : undefined;
}

/** The lines between two fences, each without the indentation the opening fence had. */
function unindent(lines: readonly string[], indent: number): string {
  return lines
    .map((line) => {
      let at = 0;
      while (at < indent && line[at] === " ") {
        at += 1;
      }
      return at === 0 ? line : line.slice(at);
    })
    .join("\n");
}

/**
 * The tables and the fenced code blocks of `text`, in document order. A table is a row with a
 * pipe, a delimiter row of as many cells under it, and the rows that follow up to a blank line,
 * a line without a pipe or the start of another block; what stands inside a fenced or an HTML
 * block, in the front-matter, or indented as code is no table. A fence left open runs to the end.
 */
export function dataOfMarkdown(text: string): MarkdownData {
  const split = splitFrontMatter(text);
  const bodyOffset = split.kind === "found" ? text.length - split.body.length : 0;
  const tables: MarkdownTable[] = [];
  const code: MarkdownCodeBlock[] = [];
  const blocks = openBlocks();
  /** The code block the scan is in: where it began, what it said, and its lines so far. */
  let open:
    | {
        readonly offset: number;
        readonly language: string;
        readonly indent: number;
        lines: string[];
      }
    | undefined;
  /** The table the scan is in. */
  let table: { readonly offset: number; readonly columns: string[]; rows: string[][] } | undefined;
  /** The line before this one, when it could be the header row of a table. */
  let header: { readonly offset: number; readonly line: string } | undefined;
  const endTable = (): void => {
    if (table !== undefined) {
      tables.push(table);
      table = undefined;
    }
  };
  const endCode = (): void => {
    if (open !== undefined) {
      code.push({
        offset: open.offset,
        language: open.language,
        text: unindent(open.lines, open.indent),
      });
      open = undefined;
    }
  };

  let lineStart = bodyOffset;
  while (lineStart <= text.length) {
    const lineBreak = text.indexOf("\n", lineStart);
    const lineEnd = lineBreak < 0 ? text.length : lineBreak;
    const raw = text.slice(lineStart, lineEnd);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const head = line.slice(0, MAX_HEADING_LINE_LENGTH);
    const offset = lineStart;
    lineStart = lineBreak < 0 ? text.length + 1 : lineBreak + 1;

    const wasFenced = blocks.fence !== undefined;
    if (consumeBlockLine(blocks, head)) {
      const isFenced = blocks.fence !== undefined;
      endTable();
      header = undefined;
      if (!wasFenced && isFenced) {
        const marker = FENCE.exec(head);
        const info = head.slice(marker?.[0].length ?? 0).trim();
        open = {
          offset,
          language: info.split(/\s+/, 1)[0] ?? "",
          indent: (marker?.[0].length ?? 0) - (marker?.[1]?.length ?? 0),
          lines: [],
        };
      } else if (wasFenced && isFenced) {
        open?.lines.push(line);
      } else if (wasFenced) {
        endCode();
      }
      continue;
    }
    if (table !== undefined) {
      if (BLANK.test(head) || !isRow(line) || HEADING.test(head) || OTHER_BLOCK.test(head)) {
        endTable();
      } else {
        const cells = cellsOf(line);
        const width = table.columns.length;
        table.rows.push(
          cells.length >= width
            ? cells.slice(0, width)
            : [...cells, ...new Array<string>(width - cells.length).fill("")],
        );
        continue;
      }
    }
    if (header !== undefined) {
      const delimiter = delimiterOf(line);
      const columns = delimiter === undefined ? undefined : cellsOf(header.line);
      if (columns !== undefined && columns.length === delimiter?.length) {
        table = { offset: header.offset, columns, rows: [] };
        header = undefined;
        continue;
      }
    }
    header =
      isRow(line) && !BLANK.test(head) && !HEADING.test(head) && !OTHER_BLOCK.test(head)
        ? { offset, line }
        : undefined;
  }
  endTable();
  endCode();
  return { tables, code };
}

/** A value as a CSV field: quoted when it holds a comma, a quote or a line break. */
const csvField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Rows as CSV (RFC 4180): one line per row, CRLF between them and after the last. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(csvField).join(",")}\r\n`).join("");
}
