// The English stemmer of the Snowball project, which is the `english_stem` dictionary of
// PostgreSQL's `english` text-search configuration: a word in, its stem out, so that an index
// searched in memory matches the words a deployment's index matches (ADR-0053). Written from the
// published algorithm; the integration test of @skillcdn/db holds it against PostgreSQL itself.

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);
const DOUBLES = new Set(["bb", "dd", "ff", "gg", "mm", "nn", "pp", "rr", "tt"]);
const LI_ENDINGS = new Set(["c", "d", "e", "g", "h", "k", "m", "n", "r", "t"]);

/** Words the algorithm would get wrong, and their stems; the invariants map to themselves. */
const EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["skis", "ski"],
  ["skies", "sky"],
  ["dying", "die"],
  ["lying", "lie"],
  ["tying", "tie"],
  ["idly", "idl"],
  ["gently", "gentl"],
  ["ugly", "ugli"],
  ["early", "earli"],
  ["only", "onli"],
  ["singly", "singl"],
  ["sky", "sky"],
  ["news", "news"],
  ["howe", "howe"],
  ["atlas", "atlas"],
  ["cosmos", "cosmos"],
  ["bias", "bias"],
  ["andes", "andes"],
]);

/** Words left alone after step 1a. */
const AFTER_1A = new Set([
  "inning",
  "outing",
  "canning",
  "herring",
  "earring",
  "proceed",
  "exceed",
  "succeed",
]);

const isVowel = (word: string, index: number): boolean => VOWELS.has(word[index] ?? "");

/** Where R1 starts: after the first non-vowel that follows a vowel, or the end. */
function regionStart(word: string, from: number): number {
  for (let index = from; index < word.length - 1; index += 1) {
    if (isVowel(word, index) && !isVowel(word, index + 1)) {
      return index + 2;
    }
  }
  return word.length;
}

function r1Of(word: string): number {
  for (const prefix of ["gener", "commun", "arsen"]) {
    if (word.startsWith(prefix)) {
      return prefix.length;
    }
  }
  return regionStart(word, 0);
}

/** A vowel followed by a non-vowel other than w, x or Y, and preceded by a non-vowel; or a vowel at the start followed by a non-vowel. */
function endsInShortSyllable(word: string): boolean {
  const length = word.length;
  if (length < 2) {
    return false;
  }
  if (length === 2) {
    return isVowel(word, 0) && !isVowel(word, 1);
  }
  const last = word[length - 1] ?? "";
  return (
    isVowel(word, length - 2) &&
    !isVowel(word, length - 1) &&
    last !== "w" &&
    last !== "x" &&
    last !== "Y" &&
    !isVowel(word, length - 3)
  );
}

const isShort = (word: string, r1: number): boolean =>
  r1 >= word.length && endsInShortSyllable(word);

const hasVowelBefore = (word: string, end: number): boolean => {
  for (let index = 0; index < end; index += 1) {
    if (isVowel(word, index)) {
      return true;
    }
  }
  return false;
};

/** The longest of `suffixes` that ends `word`, or nothing. */
function suffixOf(word: string, suffixes: readonly string[]): string | undefined {
  let found: string | undefined;
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && (found === undefined || suffix.length > found.length)) {
      found = suffix;
    }
  }
  return found;
}

const replace = (word: string, suffix: string, replacement: string): string =>
  `${word.slice(0, word.length - suffix.length)}${replacement}`;

function step1a(word: string): string {
  const suffix = suffixOf(word, ["sses", "ied", "ies", "us", "ss", "s"]);
  switch (suffix) {
    case "sses":
      return replace(word, suffix, "ss");
    case "ied":
    case "ies":
      return replace(word, suffix, word.length - suffix.length > 1 ? "i" : "ie");
    case "s": {
      // Deleted when a vowel comes before the letter that precedes the s.
      return hasVowelBefore(word, word.length - 2) ? word.slice(0, -1) : word;
    }
    default:
      return word;
  }
}

function step1b(word: string, r1: number): string {
  const suffix = suffixOf(word, ["eedly", "eed", "ingly", "edly", "ing", "ed"]);
  if (suffix === undefined) {
    return word;
  }
  if (suffix === "eed" || suffix === "eedly") {
    return word.length - suffix.length >= r1 ? replace(word, suffix, "ee") : word;
  }
  const stem = word.slice(0, word.length - suffix.length);
  if (!hasVowelBefore(stem, stem.length)) {
    return word;
  }
  if (stem.endsWith("at") || stem.endsWith("bl") || stem.endsWith("iz")) {
    return `${stem}e`;
  }
  if (DOUBLES.has(stem.slice(-2))) {
    return stem.slice(0, -1);
  }
  return isShort(stem, r1) ? `${stem}e` : stem;
}

function step1c(word: string): string {
  const last = word[word.length - 1];
  return (last === "y" || last === "Y") && word.length > 2 && !isVowel(word, word.length - 2)
    ? `${word.slice(0, -1)}i`
    : word;
}

const STEP_2: readonly (readonly [string, string])[] = [
  ["ization", "ize"],
  ["ational", "ate"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["iveness", "ive"],
  ["tional", "tion"],
  ["biliti", "ble"],
  ["lessli", "less"],
  ["entli", "ent"],
  ["ation", "ate"],
  ["alism", "al"],
  ["aliti", "al"],
  ["ousli", "ous"],
  ["iviti", "ive"],
  ["fulli", "ful"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["abli", "able"],
  ["izer", "ize"],
  ["ator", "ate"],
  ["alli", "al"],
  ["bli", "ble"],
  ["ogi", "og"],
  ["li", ""],
];

function step2(word: string, r1: number): string {
  const suffix = suffixOf(
    word,
    STEP_2.map(([ending]) => ending),
  );
  if (suffix === undefined || word.length - suffix.length < r1) {
    return word;
  }
  const stem = word.slice(0, word.length - suffix.length);
  if (suffix === "ogi") {
    return stem.endsWith("l") ? `${stem}og` : word;
  }
  if (suffix === "li") {
    return LI_ENDINGS.has(stem[stem.length - 1] ?? "") ? stem : word;
  }
  const replacement = STEP_2.find(([ending]) => ending === suffix)?.[1] ?? "";
  return `${stem}${replacement}`;
}

const STEP_3: readonly (readonly [string, string])[] = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["alize", "al"],
  ["icate", "ic"],
  ["iciti", "ic"],
  ["ative", ""],
  ["ical", "ic"],
  ["ness", ""],
  ["ful", ""],
];

function step3(word: string, r1: number, r2: number): string {
  const suffix = suffixOf(
    word,
    STEP_3.map(([ending]) => ending),
  );
  if (suffix === undefined || word.length - suffix.length < r1) {
    return word;
  }
  if (suffix === "ative" && word.length - suffix.length < r2) {
    return word;
  }
  const replacement = STEP_3.find(([ending]) => ending === suffix)?.[1] ?? "";
  return replace(word, suffix, replacement);
}

const STEP_4 = [
  "ement",
  "ance",
  "ence",
  "able",
  "ible",
  "ment",
  "ant",
  "ent",
  "ism",
  "ate",
  "iti",
  "ous",
  "ive",
  "ize",
  "ion",
  "al",
  "er",
  "ic",
];

function step4(word: string, r2: number): string {
  const suffix = suffixOf(word, STEP_4);
  if (suffix === undefined || word.length - suffix.length < r2) {
    return word;
  }
  const stem = word.slice(0, word.length - suffix.length);
  if (suffix === "ion") {
    return stem.endsWith("s") || stem.endsWith("t") ? stem : word;
  }
  return stem;
}

function step5(word: string, r1: number, r2: number): string {
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    if (stem.length >= r2) {
      return stem;
    }
    if (stem.length >= r1 && !endsInShortSyllable(stem)) {
      return stem;
    }
    return word;
  }
  if (word.endsWith("l") && word.length - 1 >= r2 && word.endsWith("ll")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Marks the y that is a consonant with Y, so that the vowel tests read it right. */
function markConsonantY(word: string): string {
  let marked = "";
  for (let index = 0; index < word.length; index += 1) {
    const character = word[index] ?? "";
    marked += character === "y" && (index === 0 || isVowel(word, index - 1)) ? "Y" : character;
  }
  return marked;
}

/**
 * The stem of one lowercase word, as PostgreSQL's `english_stem` dictionary gives it: the
 * Snowball English stemmer. A word of one or two letters is its own stem.
 */
export function stemEnglish(input: string): string {
  let word = input.startsWith("'") ? input.slice(1) : input;
  if (word.length <= 2) {
    return word;
  }
  const exception = EXCEPTIONS.get(word);
  if (exception !== undefined) {
    return exception;
  }
  word = markConsonantY(word);
  const r1 = r1Of(word);
  const r2 = regionStart(word, r1);

  // Step 0: the possessive.
  const possessive = suffixOf(word, ["'s'", "'s", "'"]);
  if (possessive !== undefined) {
    word = word.slice(0, word.length - possessive.length);
  }
  word = step1a(word);
  if (AFTER_1A.has(word)) {
    return word;
  }
  word = step1b(word, r1);
  word = step1c(word);
  word = step2(word, r1);
  word = step3(word, r1, r2);
  word = step4(word, r2);
  word = step5(word, r1, r2);
  return word.replaceAll("Y", "y");
}
