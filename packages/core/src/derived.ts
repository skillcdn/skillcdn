import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import { consumeBlockLine, MAX_HEADING_LINE_LENGTH, openBlocks } from "./markdown-blocks.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

// A document made from the pack's documents (ADR-0083): a note of what a run learned, a
// glossary, a list of open questions. It says so in its front-matter, and what it quotes it
// quotes exactly, in a block quote whose last line links to the section quoted, so that the
// quotation can be held against that section when the pack is checked: a note is only as good
// as what it points to, and an agent quotes the section, never the note.

/** What a document says of how it was made from other documents of the pack. */
export interface DocumentDerivation {
  /** What it is, as written: `note`, `glossary`. */
  readonly kind: string | undefined;
  /** What it was made from: paths of documents or folders, written as a link destination is. */
  readonly from: readonly string[];
  /** Who or what made it, as written. */
  readonly by: string | undefined;
  /** When, as written. */
  readonly at: string | undefined;
}

const MAX_FIELD_LENGTH = 200;
const MAX_DERIVED_FROM = 20;

function field(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.replaceAll(/\s+/g, " ").trim();
  return text.length === 0 || hasForbiddenCodePoint(text)
    ? undefined
    : text.slice(0, MAX_FIELD_LENGTH);
}

/**
 * What the front-matter `derived` of a document says: a mapping with `kind`, `from` (one path or
 * a list), `by` and `at`, each optional; or a word alone, which is the kind. `undefined` for a
 * document that does not say it is derived, and for front-matter that cannot be read.
 */
export function documentDerivation(text: string): DocumentDerivation | undefined {
  const split = splitFrontMatter(text);
  if (split.kind !== "found") {
    return undefined;
  }
  const parsed = parseFrontMatter(split.source);
  if (!parsed.ok) {
    return undefined;
  }
  const derived = parsed.value.get("derived");
  if (derived instanceof Map) {
    const from: unknown = derived.get("from");
    const list: unknown[] = Array.isArray(from) ? from : [from];
    return {
      kind: field(derived.get("kind")),
      from: list.flatMap((item) => field(item) ?? []).slice(0, MAX_DERIVED_FROM),
      by: field(derived.get("by")),
      at: field(derived.get("at")),
    };
  }
  const kind = field(derived);
  return kind === undefined || kind === "false" || kind === "no"
    ? undefined
    : {
        kind: kind === "true" || kind === "yes" ? undefined : kind,
        from: [],
        by: undefined,
        at: undefined,
      };
}

/** A block quote of a document, as a quotation with where it says it is from. */
export interface Quotation {
  /** Where the block quote starts, in characters from the start of the file. */
  readonly offset: number;
  /** The quoted lines without their markers, and without the line that names the source. */
  readonly text: string;
  /** The last line of the block: where the quotation says it is from. Empty for a block of nothing. */
  readonly source: string;
}

/** A document of more block quotes than this has its first ones looked at. */
export const MAX_QUOTATIONS = 500;

const QUOTE_LINE = /^ {0,3}> ?/;

/**
 * The block quotes of a Markdown document, in order: each a run of lines that begin with `>`,
 * outside fenced code and HTML blocks, its last line that is not blank taken as the line that
 * names its source. Linear in the text.
 */
export function quotationsOf(text: string): Quotation[] {
  const split = splitFrontMatter(text);
  const bodyOffset = split.kind === "found" ? text.length - split.body.length : 0;
  const quotations: Quotation[] = [];
  const blocks = openBlocks();
  let open: { readonly offset: number; lines: string[] } | undefined;
  const close = (): void => {
    if (open === undefined) {
      return;
    }
    const lines = open.lines;
    while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim().length === 0) {
      lines.pop();
    }
    const source = lines.pop() ?? "";
    while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim().length === 0) {
      lines.pop();
    }
    if (quotations.length < MAX_QUOTATIONS) {
      quotations.push({ offset: open.offset, text: lines.join("\n"), source: source.trim() });
    }
    open = undefined;
  };
  let lineStart = bodyOffset;
  while (lineStart <= text.length) {
    const lineBreak = text.indexOf("\n", lineStart);
    const raw = text.slice(lineStart, lineBreak < 0 ? text.length : lineBreak);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const offset = lineStart;
    lineStart = lineBreak < 0 ? text.length + 1 : lineBreak + 1;
    if (consumeBlockLine(blocks, line.slice(0, MAX_HEADING_LINE_LENGTH))) {
      close();
      continue;
    }
    const marker = QUOTE_LINE.exec(line);
    if (marker === null) {
      close();
      continue;
    }
    open ??= { offset, lines: [] };
    open.lines.push(line.slice(marker[0].length));
  }
  close();
  return quotations;
}

/**
 * A text as a quotation is held against its source: links as their words, without the marks of
 * emphasis, of code, of a table's cells and of an escape, every run of blanks as one. The same
 * folding is done to both sides, so what it takes out is what a quotation may leave out. Linear:
 * the next closing parenthesis and line break are found once and reused.
 */
export function foldQuoted(text: string): string {
  const kept: string[] = [];
  let from = 0;
  let closing = -1;
  let lineBreak = -1;
  const next = (needle: string, at: number): number => {
    const found = text.indexOf(needle, at);
    return found < 0 ? text.length : found;
  };
  // A link's destination, `](...)` on one line, is no part of what a text says.
  let at = text.indexOf("](");
  while (at >= 0) {
    if (closing < at) closing = next(")", at + 2);
    if (lineBreak < at) lineBreak = next("\n", at + 2);
    if (closing < text.length && closing < lineBreak) {
      kept.push(text.slice(from, at));
      from = closing + 1;
      at = text.indexOf("](", from);
    } else {
      at = text.indexOf("](", at + 2);
    }
  }
  kept.push(text.slice(from));
  return kept
    .join("")
    .replaceAll(/[[\]*`|\\]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** What stands for words left out of a quotation: an ellipsis, or three dots. */
const ELISION = /…|\.{3}/;

/**
 * Whether a quotation stands in a source word for word, both folded as {@link foldQuoted} folds
 * them: the parts of the quotation between its elisions are found in the source in their order.
 * A quotation of nothing stands anywhere.
 */
export function quotationStandsIn(quotation: string, source: string): boolean {
  const hay = foldQuoted(source);
  let at = 0;
  for (const part of foldQuoted(quotation).split(ELISION)) {
    const wanted = part.trim();
    if (wanted.length === 0) {
      continue;
    }
    const found = hay.indexOf(wanted, at);
    if (found < 0) {
      return false;
    }
    at = found + wanted.length;
  }
  return true;
}
