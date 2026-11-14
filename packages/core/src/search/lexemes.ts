import { stemEnglish } from "./english-stemmer.js";
import { ENGLISH_STOP_WORDS } from "./stop-words.js";

// The words of a text, as every index of a pack reads them: the deployment's index in PostgreSQL
// and the command's index in memory are both built from these lexemes, so that a pack is found by
// the same words wherever it is served (ADR-0053, ADR-0063). The text is cut into tokens as
// PostgreSQL's default parser cuts text in the Latin script: words, numbers, hyphenated words,
// hosts, versions, paths, URLs and addresses; the words of a language with a stemmer are stemmed
// and its stop words dropped, and the scripts without word stems (Han, Hangul, Hiragana and
// Katakana) are matched by pairs of characters, so that an inflected word is found by its stem.
// Two things are added to what the parser makes: a hyphenated code with a digit part is a word
// beside its parts (ADR-0069), and a token joined by slashes or dots is a word beside the words
// it joins (ADR-0078), as the parser itself reads a hyphenated word.
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

/**
 * A lexeme longer than this, in UTF-8 bytes, is not a word to the index: PostgreSQL's parser
 * ignores a word of 2047 bytes or more, and its tsvector parser rejects one, which would fail the
 * storing of the whole vector.
 */
export const MAX_LEXEME_BYTES = 2046;
/** A token this long in characters may be over the byte limit; shorter ones never are. */
const SHORT_ENOUGH = Math.floor(MAX_LEXEME_BYTES / 3);

/**
 * A run of what can be in a word: letters, digits, and the dots, hyphens and slashes that join
 * them; a hyphen before digits is their sign. An underscore joins as well, and parts the run:
 * what stands on either side of it is read as it always was, and a name written with
 * underscores is a word beside them (ADR-0100).
 */
const RUN = /(?:\/|-(?=\p{N}))?[\p{L}\p{N}][\p{L}\p{N}./_-]*/u;
/**
 * `scheme://host/path`: the parser keeps the host with the path, the host, and the path, and drops
 * the scheme. A scheme is short: the bound keeps a text of letters and plus signs, which looks
 * like the start of a scheme at every letter, from being read again from each of them.
 */
const URL = /[a-z][a-z0-9+.-]{0,39}:\/\/([^\s/"'<>()[\]{}]+)(\/[^\s"'<>()[\]{}]*)?/u;
/**
 * `user@host`, one word to the parser. The part before the sign is at most the 64 characters a
 * mailbox has: without the bound a line of underscores, dots or hyphens, which could each begin
 * one, is read to its end from every character of it.
 */
const EMAIL = /[\p{L}\p{N}._-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
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
/** A code: parts of letters and digits joined by single hyphens, `OIW-PV-120`, `6635-81-302-5518`, `서돌-4`. */
const CODE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+$/u;
/** A name: parts of letters and digits joined by single underscores, `TIDE_RATE_C2`, `berth_id`. */
const NAME = /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+$/u;

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

/**
 * The words a slash or a dot joined into one token, each read as a run of its own, in order
 * (ADR-0078). A part holds no slash, and a part of a dotted token no dot, so this goes no deeper
 * than the joints a token has.
 */
function partsOf(parts: readonly string[], withoutNumbers: boolean): Token[] {
  const tokens: Token[] = [];
  for (const part of parts) {
    if (part.length === 0 || (withoutNumbers && DIGITS.test(part))) {
      continue;
    }
    for (const token of tokensOfRun(part)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** A dot, a slash or a hyphen: what joins the parts of a run, and is a blank at its ends. */
const isJoint = (character: string | undefined): boolean =>
  character === "." || character === "/" || character === "-";

/**
 * The tokens of one run of word characters in the Latin script, in the order the parser emits
 * them. The work is linear in the run, whatever it is made of: a run of a hundred thousand
 * versions joined by hyphens is read in a loop, not by a call for each.
 */
function tokensOfRun(run: string): Token[] {
  // Dots, slashes and hyphens at the end are blanks.
  let end = run.length;
  while (end > 0 && isJoint(run[end - 1])) {
    end -= 1;
  }
  const whole = end === run.length ? run : run.slice(0, end);
  const lastSlash = whole.lastIndexOf("/");
  const lastDot = whole.lastIndexOf(".");
  const tokens: Token[] = [];
  let start = 0;
  for (;;) {
    // A leading slash stays only on a path; leading dots are blanks.
    if (whole[start] === "/" && lastSlash <= start) {
      start += 1;
    }
    while (whole[start] === ".") {
      start += 1;
    }
    if (start >= whole.length) {
      return tokens;
    }
    if (lastSlash < start && lastDot >= start) {
      // A version or a number with a point ends at a hyphen, and what follows the hyphen is read
      // as a run of its own; a host takes the hyphen in.
      const hyphen = whole.indexOf("-", start);
      if (hyphen > start && /^[\p{N}.]+$/u.test(whole.slice(start, hyphen))) {
        tokens.push({ text: whole.slice(start, hyphen), stem: false });
        start = hyphen + 1;
        continue;
      }
    }
    for (const token of tokensOfWord(start === 0 ? whole : whole.slice(start))) {
      tokens.push(token);
    }
    return tokens;
  }
}

/** The tokens of a run without the blanks at its ends, and without a version at its head. */
function tokensOfWord(text: string): Token[] {
  if (text.includes("/")) {
    // A path, as the parser's file token: one word, as written. And the words the slashes join,
    // each read as a run of its own, as a hyphenated word is a word beside its parts: documents
    // write alternatives and codes this way (`open/closed/held`), and one of them is asked for
    // alone (ADR-0078).
    return [{ text, stem: false }, ...partsOf(text.split("/"), false)];
  }
  if (text.includes(".")) {
    // A host, a file name, a dotted name: one word as written, and the words the dots join
    // (`ops.intake.queue`, `guide.md`) beside it. A part of digits alone is no word of its own:
    // a section number or a version (`4.2.6`) names one thing as a whole, and its digits would
    // match every other number.
    return [{ text, stem: false }, ...partsOf(text.split("."), true)];
  }
  if (!text.includes("-")) {
    return [wordToken(text)];
  }
  // Hyphenated. Two hyphens in a row, or a part that is only digits, break the word apart: a
  // hyphen before digits is their sign. Otherwise the whole word comes first, then its parts.
  const parts = text.split("-");
  if (parts.some((part) => part.length === 0 || DIGITS.test(part))) {
    const tokens: Token[] = [];
    // A code with a digit part, `OIW-PV-120` or `6635-81-302-5518`, is kept whole as well: its
    // parts say little on their own, and the whole names one thing (ADR-0069). A sign (`-5`) or a
    // doubled hyphen makes no code.
    if (CODE.test(text)) {
      tokens.push({ text, stem: false });
    }
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

/**
 * The tokens of a run that underscores part: the name whole, where the run is one, then what
 * stands between the underscores, each read as a run of its own, as it was before a name was a
 * word (ADR-0100). A field of an interface or an identifier of code is written this way, and is
 * asked for as written: its parts are in every row of the table that lists it. A run that is
 * no name, a file `my_module.py` or a run with an underscore at its end, is its parts alone.
 */
function tokensOfName(run: string): Token[] {
  const tokens: Token[] = NAME.test(run) ? [{ text: run, stem: false }] : [];
  for (const part of run.split("_")) {
    if (part.length === 0) {
      continue;
    }
    for (const token of tokensOfScripts(part)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** The tokens of a run, its scripts cut apart: pairs for the scripts without stems, words for the rest. */
function tokensOfScripts(run: string): Token[] {
  if (run.includes("_")) {
    return tokensOfName(run);
  }
  const tokens: Token[] = [];
  const pieces = run.match(SCRIPT_RUNS) ?? [];
  // A code across scripts, `서돌-4` or `蒼陵-2`, is kept whole as well, as a code in one script is
  // (ADR-0069); its pieces follow, as pairs and as words.
  if (pieces.length > 1 && CODE.test(run)) {
    tokens.push({ text: run, stem: false });
  }
  for (const piece of pieces) {
    // One by one: a run of some hundred thousand characters has more pairs than one call takes.
    for (const token of CJK.test(piece) ? bigramTokens(piece) : tokensOfRun(piece)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** The UTF-8 length of a string, counted from its code points: this package loads no platform API. */
export function utf8Length(text: string): number {
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
      // A URL: the host with its path, the host, and the path, when there is one. A host of dots
      // alone, as a placeholder is written (`https://...`), is no word: the parser reads the
      // scheme and a blank there, and the path after it as a file on its own.
      const site = host.replace(/\.+$/u, "");
      const file = path !== undefined && path.length > 1 ? path : undefined;
      if (site.length > 0) {
        if (file !== undefined) {
          tokens.push({ text: `${site}${file}`, stem: false });
        }
        tokens.push({ text: site, stem: false });
      }
      if (file !== undefined) {
        tokens.push({ text: file, stem: false });
      }
      continue;
    }
    if (whole.includes("@")) {
      tokens.push({ text: whole, stem: false });
      continue;
    }
    for (const token of tokensOfScripts(whole)) {
      tokens.push(token);
    }
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
    if (token.stem && rules.stopWords.has(token.text)) {
      continue;
    }
    const lexeme = token.stem ? rules.stem(token.text) : token.text;
    // An empty lexeme is no word, whatever rule left it: a tsvector that holds one is rejected.
    if (lexeme.length === 0) {
      continue;
    }
    lexemes.push({ lexeme, position });
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
