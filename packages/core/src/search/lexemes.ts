import { stemEnglish } from "./english-stemmer.js";
import { ENGLISH_STOP_WORDS } from "./stop-words.js";

// The words of a text as PostgreSQL's `english` configuration reads them: its default parser
// cut into tokens, the stop words dropped, the rest stemmed or kept as written by what the
// token is. An index searched in memory matches the same words as one the deployment searches
// with `to_tsvector` and `plainto_tsquery` (ADR-0053); the integration test of @skillcdn/db holds
// this file against the database. The parser is a state machine with many token kinds; what is
// here is the part of it that text in a pack meets: words, numbers, hyphenated words, hosts,
// versions, paths, URLs and addresses.

/** One word of a text, at the position the text-search configuration would give it. */
export interface Lexeme {
  readonly lexeme: string;
  /** Counted from 1 over every token the parser cut, the dropped stop words included. */
  readonly position: number;
}

/** A token longer than this is not a word to the parser. */
const MAX_TOKEN_LENGTH = 2047;

/** A run of what can be in a word: letters, digits, and the dots, hyphens and slashes that join them; a hyphen before digits is their sign. */
const RUN = /(?:\/|-(?=\p{N}))?[\p{L}\p{N}][\p{L}\p{N}./-]*/u;
/** `scheme://host/path`: the parser keeps the host with the path, the host, and the path, and drops the scheme. */
const URL = /[a-z][a-z0-9+.-]*:\/\/([^\s/"'<>()[\]{}]+)(\/[^\s"'<>()[\]{}]*)?/u;
/** `user@host`, one word to the parser. */
const EMAIL = /[\p{L}\p{N}._-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
const TOKENS = new RegExp(`${URL.source}|${EMAIL.source}|${RUN.source}`, "gu");

const LETTERS = /^\p{L}+$/u;
const DIGITS = /^\p{N}+$/u;
const WORDY = /^[\p{L}\p{N}]*\p{L}[\p{L}\p{N}]*$/u;

/** A raw token and which dictionary reads it: letters are stemmed, everything else is kept. */
interface Token {
  readonly text: string;
  readonly stem: boolean;
}

function wordToken(text: string): Token {
  return { text, stem: LETTERS.test(text) };
}

/** The tokens of one run of word characters, in the order the parser emits them. */
function tokensOfRun(run: string): Token[] {
  // A leading slash stays only on a path; dots, slashes and hyphens at the ends are blanks.
  let text = run.replace(/[./-]+$/u, "");
  if (text.startsWith("/") && !text.slice(1).includes("/")) {
    text = text.slice(1);
  }
  text = text.replace(/^\.+/u, "");
  if (text.length === 0) {
    return [];
  }
  if (text.includes("/")) {
    // A path, as the parser's file token: one word, as written.
    return [{ text, stem: false }];
  }
  if (text.includes(".")) {
    // A version or a number with a point ends at a hyphen; a host takes the hyphen in. Either
    // way, one word as written.
    const hyphen = text.indexOf("-");
    if (hyphen > 0 && /^[\p{N}.]+$/u.test(text.slice(0, hyphen))) {
      return [{ text: text.slice(0, hyphen), stem: false }, ...tokensOfRun(text.slice(hyphen + 1))];
    }
    return [{ text, stem: false }];
  }
  if (!text.includes("-")) {
    return [wordToken(text)];
  }
  // Hyphenated. Two hyphens in a row, or a part that is only digits, break the word apart: a
  // hyphen before digits is their sign. Otherwise the whole word comes first, then its parts.
  const parts = text.split("-");
  if (parts.some((part) => part.length === 0 || DIGITS.test(part))) {
    const tokens: Token[] = [];
    parts.forEach((part, index) => {
      if (part.length === 0) {
        return;
      }
      const signed = index > 0 && DIGITS.test(part);
      tokens.push(signed ? { text: `-${part}`, stem: false } : wordToken(part));
    });
    return tokens;
  }
  const whole: Token = { text, stem: parts.every((part) => LETTERS.test(part)) };
  return [whole, ...parts.filter((part) => WORDY.test(part)).map(wordToken)];
}

function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.toLowerCase().matchAll(TOKENS)) {
    const [whole, host, path] = match;
    if (host !== undefined) {
      // A URL: the host with its path, the host, and the path, when there is one.
      const site = host.replace(/\.+$/u, "");
      if (path !== undefined && path.length > 1) {
        tokens.push({ text: `${site}${path}`, stem: false });
      }
      tokens.push({ text: site, stem: false });
      if (path !== undefined && path.length > 1) {
        tokens.push({ text: path, stem: false });
      }
      continue;
    }
    if (whole.includes("@")) {
      tokens.push({ text: whole, stem: false });
      continue;
    }
    tokens.push(...tokensOfRun(whole));
  }
  return tokens.filter((token) => token.text.length <= MAX_TOKEN_LENGTH);
}

/**
 * The lexemes of a text, as `to_tsvector('english', text)` would list them: every token at its
 * position, the stop words dropped, words stemmed and everything else kept as written.
 */
export function searchLexemes(text: string): Lexeme[] {
  const lexemes: Lexeme[] = [];
  let position = 0;
  for (const token of tokensOf(text)) {
    position += 1;
    if (!token.stem) {
      lexemes.push({ lexeme: token.text, position });
      continue;
    }
    if (ENGLISH_STOP_WORDS.has(token.text)) {
      continue;
    }
    lexemes.push({ lexeme: stemEnglish(token.text), position });
  }
  return lexemes;
}

/**
 * The lexemes a query is made of, as `plainto_tsquery('english', query)` would read them, each
 * once: a search matches a document that has any of them. Empty for a query of stop words and
 * punctuation alone, which matches nothing.
 */
export function queryLexemes(query: string): string[] {
  return [...new Set(searchLexemes(query).map((lexeme) => lexeme.lexeme))];
}
