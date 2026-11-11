import { outlineMarkdown } from "./outline.js";

// A query that names a thing instead of describing it (ADR-0079): the number of a section, the
// name of a table, the identifier of a definition. The search by meaning has nothing to say of
// such a query, since a number is near every other number and a name near every name like it,
// and fused with the words it buries the one document the words would have named. So the words
// rank a query that is identifiers alone, and a document one of whose headings names the
// identifier a query begins with stands first.

/** What a query says of itself by the way it is written. */
export interface QueryIdentifiers {
  /**
   * True when the query is at most {@link MAX_IDENTIFIER_TOKENS} tokens and every one of them is
   * an identifier: such a query is ranked by its words.
   */
  readonly only: boolean;
  /**
   * The identifiers the query begins with, as written, when it begins with any: what a heading is
   * held against. A word of kind alone (`table of contents`) begins with none.
   */
  readonly leading: string | undefined;
}

/** A query of more tokens than this is a sentence, whatever its tokens look like. */
export const MAX_IDENTIFIER_TOKENS = 4;

/** A query is at most 500 characters and a heading 200; what is past this many tokens is not looked at. */
const MAX_TOKENS = 64;

/**
 * Words that say what kind of thing an identifier names and nothing of which one: an identifier
 * when one stands beside them, no identifier by themselves.
 */
const KIND_WORDS: ReadonlySet<string> = new Set([
  "table",
  "figure",
  "section",
  "clause",
  "annex",
  "appendix",
  "chapter",
]);

/** What stands around a token without being part of it: quotes, brackets, the marks that end a clause. */
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const DIGIT = /\p{N}/u;
/** An upper-case letter after the first character: `maxRetries`, `ResumeGuardTimes`, `TABLE`. */
const INNER_CAPITAL = /.\p{Lu}/u;
const ONE_CAPITAL = /^\p{Lu}$/u;

/** The tokens of a query or a heading, each without what stands around it; empty ones dropped. */
function tokensOf(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.split(/\s+/u)) {
    const token = raw.replace(EDGES, "");
    if (token.length > 0) {
      tokens.push(token);
      if (tokens.length >= MAX_TOKENS) {
        break;
      }
    }
  }
  return tokens;
}

const isKindWord = (token: string): boolean => KIND_WORDS.has(token.toLowerCase());

/**
 * Whether a token is written as an identifier: it holds a digit, or an upper-case letter after
 * its first character, or it is a word of kind; or it is the one capital letter that follows a
 * word of kind (`Annex B`). A word with a capital first letter alone is a word.
 */
function isIdentifier(token: string, previous: string | undefined): boolean {
  return (
    DIGIT.test(token) ||
    INNER_CAPITAL.test(token) ||
    isKindWord(token) ||
    (ONE_CAPITAL.test(token) && previous !== undefined && isKindWord(previous))
  );
}

/** What a query says of itself by the way it is written (ADR-0079). */
export function queryIdentifiers(query: string): QueryIdentifiers {
  const tokens = tokensOf(query);
  let count = 0;
  while (
    count < tokens.length &&
    count < MAX_IDENTIFIER_TOKENS &&
    isIdentifier(tokens[count] ?? "", tokens[count - 1])
  ) {
    count += 1;
  }
  const leading = tokens.slice(0, count);
  // A word of kind names nothing by itself: `table of contents` begins with no identifier.
  const names = leading.some((token) => !isKindWord(token));
  return {
    only: names && count === tokens.length,
    leading: names ? leading.join(" ") : undefined,
  };
}

/**
 * Whether a heading names the identifiers of `leading`: they stand in it one after another,
 * token for token, whatever the case and whatever stands around a token. `4.2.6 Link resumption`
 * and `Changes to (4.2.6)` name `4.2.6`, `TABLE C-2: condition codes` names `table c-2`,
 * `6.1.8 ResumeGuardTimes` names `ResumeGuardTimes`, and `4.2.6.1 Guard times` names neither
 * `4.2.6` nor `4.2`, since `4.2.6.1` is another number.
 */
export function headingNames(heading: string, leading: string): boolean {
  const wanted = tokensOf(leading).map((token) => token.toLowerCase());
  if (wanted.length === 0) {
    return false;
  }
  const have = tokensOf(heading).map((token) => token.toLowerCase());
  for (let start = 0; start + wanted.length <= have.length; start += 1) {
    if (wanted.every((token, at) => have[start + at] === token)) {
      return true;
    }
  }
  return false;
}

/** Whether any heading of a Markdown document names the identifiers of `leading`. */
export function isHeadedBy(markdown: string, leading: string): boolean {
  return outlineMarkdown(markdown).headings.some((heading) => headingNames(heading.text, leading));
}
