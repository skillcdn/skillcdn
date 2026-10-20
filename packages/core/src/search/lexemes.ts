import { stemEnglish } from "./english-stemmer.js";
import { ENGLISH_STOP_WORDS } from "./stop-words.js";

// The words of a text, as every index of a pack reads them: the deployment's index in PostgreSQL
// and the command's index in memory are both built from these lexemes, so that a pack is found by
// the same words wherever it is served (ADR-0053, ADR-0063). The text is cut into tokens as
// PostgreSQL's default parser cuts text in the Latin script: words, numbers, hyphenated words,
// hosts, versions, paths, URLs and addresses; the words of a language with a stemmer are stemmed
// and its stop words dropped, and the scripts without word stems (Han, Hangul, Hiragana and
// Katakana) are matched by pairs of characters, so that an inflected word is found by its stem.
// The integration test of @skillcdn/db holds the stemmer against PostgreSQL's dictionary.

/** One word of a text, at the position the index gives it. */
export interface Lexeme {
  readonly lexeme: string;
  /** Counted from 1 over every token cut, the dropped stop words included. */
  readonly position: number;
}

/** How the words of one language are read: its stemmer and its stop words. */
export interface WordRules {
  /** The primary language subtag the rules are for. */
  readonly language: string;
  /** The stem of one lowercase word of letters. */
  readonly stem: (word: string) => string;
  /** Words dropped on both sides, so that a search for one finds nothing. */
  readonly stopWords: ReadonlySet<string>;
}

/** The English rules: the Snowball stemmer and the stop words of PostgreSQL's `english` configuration. */
const ENGLISH: WordRules = { language: "en", stem: stemEnglish, stopWords: ENGLISH_STOP_WORDS };

/** The languages with word rules of their own, by primary subtag. */
const RULES: ReadonlyMap<string, WordRules> = new Map([["en", ENGLISH]]);

/** The languages whose words are stemmed; every other language is read with English's rules. */
export const STEMMED_LANGUAGES: readonly string[] = [...RULES.keys()];

/**
 * The word rules a pack's `language` names, by its primary subtag (`en` for `en-GB`). English is
 * the authoring default and the rules of every language without rules of its own, so that a
 * pack written in another language is read as it was before its stemmer existed: its words as
 * written, the English words among them stemmed, and its scripts without word stems by pairs.
 */
export function wordRulesOf(language: string | undefined): WordRules {
  const primary = language?.split("-", 1)[0]?.toLowerCase();
  return (primary === undefined ? undefined : RULES.get(primary)) ?? ENGLISH;
}

/** A lexeme longer than this, in UTF-8 bytes, is not a word to the index. */
export const MAX_LEXEME_BYTES = 2047;
/** A token this long in characters may be over the byte limit; shorter ones never are. */
const SHORT_ENOUGH = Math.floor(MAX_LEXEME_BYTES / 3);

/** A run of what can be in a word: letters, digits, and the dots, hyphens and slashes that join them; a hyphen before digits is their sign. */
const RUN = /(?:\/|-(?=\p{N}))?[\p{L}\p{N}][\p{L}\p{N}./-]*/u;
/** `scheme://host/path`: the parser keeps the host with the path, the host, and the path, and drops the scheme. */
const URL = /[a-z][a-z0-9+.-]*:\/\/([^\s/"'<>()[\]{}]+)(\/[^\s"'<>()[\]{}]*)?/u;
/** `user@host`, one word to the parser. */
const EMAIL = /[\p{L}\p{N}._-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
const TOKENS = new RegExp(`${URL.source}|${EMAIL.source}|${RUN.source}`, "gu");

/**
 * The scripts without word stems, matched by pairs of characters: Han, Hangul, Hiragana and
 * Katakana, with the marks that extend their words (the prolonged sound mark among them). A run
 * of such characters and a run of any others are cut apart, so that a particle written onto a
 * Latin word or a number (`MCP를`, `2026년`) leaves the word and the number findable.
 */
const CJK_CLASS = String.raw`\p{scx=Han}\p{scx=Hangul}\p{scx=Hiragana}\p{scx=Katakana}`;
const CJK = new RegExp(`^[${CJK_CLASS}]`, "u");
const SCRIPT_RUNS = new RegExp(`[${CJK_CLASS}]+|[^${CJK_CLASS}]+`, "gu");

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

/** The pairs of characters of a run in a script without word stems; a run of one character is itself. */
function bigramTokens(run: string): Token[] {
  const characters = Array.from(run);
  if (characters.length < 2) {
    return characters.map((text) => ({ text, stem: false }));
  }
  const tokens: Token[] = [];
  for (let index = 0; index + 1 < characters.length; index += 1) {
    tokens.push({ text: `${characters[index]}${characters[index + 1]}`, stem: false });
  }
  return tokens;
}

/** The tokens of one run of word characters in the Latin script, in the order the parser emits them. */
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

/** The tokens of a run, its scripts cut apart: pairs for the scripts without stems, words for the rest. */
function tokensOfScripts(run: string): Token[] {
  const tokens: Token[] = [];
  for (const piece of run.match(SCRIPT_RUNS) ?? []) {
    tokens.push(...(CJK.test(piece) ? bigramTokens(piece) : tokensOfRun(piece)));
  }
  return tokens;
}

/** The UTF-8 length of a string, counted from its code points: this package loads no platform API. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
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
    tokens.push(...tokensOfScripts(whole));
  }
  return tokens.filter(
    (token) => token.text.length <= SHORT_ENOUGH || utf8Length(token.text) <= MAX_LEXEME_BYTES,
  );
}

/**
 * The lexemes of a text, as an index holds them: every token at its position, the stop words of
 * the language dropped, its words stemmed, everything else kept as written, and the scripts
 * without word stems as pairs of characters. `language` is the pack's; English when not said.
 */
export function searchLexemes(text: string, language?: string): Lexeme[] {
  const rules = wordRulesOf(language);
  const lexemes: Lexeme[] = [];
  let position = 0;
  for (const token of tokensOf(text)) {
    position += 1;
    if (!token.stem) {
      lexemes.push({ lexeme: token.text, position });
      continue;
    }
    if (rules.stopWords.has(token.text)) {
      continue;
    }
    lexemes.push({ lexeme: rules.stem(token.text), position });
  }
  return lexemes;
}

/**
 * The lexemes a query is made of, read with the same rules as the text it searches, each once: a
 * search matches a document that has any of them. Empty for a query of stop words and
 * punctuation alone, which matches nothing.
 */
export function queryLexemes(query: string, language?: string): string[] {
  return [...new Set(searchLexemes(query, language).map((lexeme) => lexeme.lexeme))];
}
