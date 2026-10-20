import { type Lexeme, searchLexemes } from "./lexemes.js";

// How a document is weighed, kept and ranked for a search: four fields, each a weight, into one
// vector of lexemes with their positions, written in the text form of a PostgreSQL `tsvector` so
// that the deployment stores it as it is and ranks it with `ts_rank`, and the command keeps and
// ranks the same vector in memory with `rankSearchVector`, which computes what `ts_rank` computes
// (ADR-0053, ADR-0063). The integration test of @skillcdn/db holds the two against each other.

/** The weight of a field, as `setweight` marks it: names first, bodies last. */
export type SearchWeight = "A" | "B" | "C" | "D";

/** What each weight counts for in a rank: the array `ts_rank` is given, `{D, C, B, A}`. */
export const SEARCH_WEIGHTS: Readonly<Record<SearchWeight, number>> = {
  A: 1.0,
  B: 0.6,
  C: 0.2,
  D: 0.05,
};

/** How the weights rank when one position is kept of several: A above D. */
const WEIGHT_RANK: Readonly<Record<SearchWeight, number>> = { A: 3, B: 2, C: 1, D: 0 };

/** Characters of a body that go into the search vector: a tsvector is limited to 1 MB. */
export const MAX_SEARCHED_BODY_LENGTH = 200_000;

/** Skills outrank plain documents by this much. */
export const SKILL_RANK_BOOST = 1.5;

/** One position a lexeme occurs at, and the weight of the field it occurred in. */
export interface SearchPosition {
  readonly position: number;
  readonly weight: SearchWeight;
}

/** A document ready to be searched: every lexeme with where it occurs, positions ascending. */
export type SearchVector = ReadonlyMap<string, readonly SearchPosition[]>;

export interface SearchField {
  readonly weight: SearchWeight;
  readonly text: string;
}

/** The largest position a vector keeps; later words are placed here. */
const MAX_POSITION = 16_383;
/** How many positions one lexeme keeps. */
const MAX_POSITIONS_PER_LEXEME = 256;

/**
 * The four fields of an index entry, as the deployment weighs them: the name and the title, the
 * description, the words of the path, and the body that is searched, the parsed body of a
 * Markdown document or the text of a JSON file, bounded.
 */
export function searchFieldsOf(
  entry: {
    readonly path: string;
    readonly name?: string | undefined;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
  },
  body: string | undefined,
): SearchField[] {
  return [
    { weight: "A", text: `${entry.name ?? ""} ${entry.title ?? ""}` },
    { weight: "B", text: entry.description ?? "" },
    { weight: "C", text: entry.path.replaceAll(/[/._-]/gu, " ") },
    { weight: "D", text: (body ?? "").slice(0, MAX_SEARCHED_BODY_LENGTH) },
  ];
}

/**
 * The positions of one lexeme as a tsvector keeps them: ascending, each position once with the
 * highest weight it was seen with, at most 256 of them, and none after the last position, which
 * every later word shares.
 */
function keptPositions(positions: readonly SearchPosition[]): SearchPosition[] {
  const sorted = [...positions].sort((a, b) => a.position - b.position);
  const kept: SearchPosition[] = [];
  for (const candidate of sorted) {
    const last = kept[kept.length - 1];
    if (last !== undefined && last.position === candidate.position) {
      if (WEIGHT_RANK[candidate.weight] > WEIGHT_RANK[last.weight]) {
        kept[kept.length - 1] = candidate;
      }
      continue;
    }
    if (last !== undefined && last.position === MAX_POSITION) {
      break;
    }
    kept.push(candidate);
    if (kept.length >= MAX_POSITIONS_PER_LEXEME) {
      break;
    }
  }
  return kept;
}

/**
 * The vector of a document: the lexemes of every field, weighted, with the positions of a later
 * field continuing after the last position of the one before, as `||` joins vectors. `language`
 * is the pack's, and chooses the word rules the fields are read with.
 */
export function searchVectorOf(fields: readonly SearchField[], language?: string): SearchVector {
  const collected = new Map<string, SearchPosition[]>();
  let offset = 0;
  for (const field of fields) {
    const lexemes: Lexeme[] = searchLexemes(field.text, language);
    let last = 0;
    for (const { lexeme, position } of lexemes) {
      const at = Math.min(offset + position, MAX_POSITION);
      last = Math.max(last, position);
      let positions = collected.get(lexeme);
      if (positions === undefined) {
        positions = [];
        collected.set(lexeme, positions);
      }
      positions.push({ position: at, weight: field.weight });
    }
    offset = Math.min(offset + last, MAX_POSITION);
  }
  const vector = new Map<string, SearchPosition[]>();
  for (const [lexeme, positions] of collected) {
    vector.set(lexeme, keptPositions(positions));
  }
  return vector;
}

/** The sum of 1/n² for n from 1: what a lexeme's occurrences are measured against. */
const BASEL = 1.64493406685;

/**
 * The rank of a vector for a query of lexemes, any of which may match, as `ts_rank` with the
 * weights above and normalization 1 computes it: each matched lexeme counts its best occurrence
 * and a little for every further one, the sum is averaged over the query's lexemes and divided
 * by the logarithm of the document's length. Zero when nothing matches.
 */
export function rankSearchVector(vector: SearchVector, query: readonly string[]): number {
  if (query.length === 0 || vector.size === 0) {
    return 0;
  }
  let rank = 0;
  for (const lexeme of query) {
    const positions = vector.get(lexeme);
    if (positions === undefined) {
      continue;
    }
    let sum = 0;
    let best = -1;
    let bestAt = 0;
    positions.forEach(({ weight }, index) => {
      const value = SEARCH_WEIGHTS[weight];
      sum += value / ((index + 1) * (index + 1));
      if (value > best) {
        best = value;
        bestAt = index;
      }
    });
    rank += (best + sum - best / ((bestAt + 1) * (bestAt + 1))) / BASEL;
  }
  if (rank === 0) {
    return 0;
  }
  rank /= query.length;
  let length = 0;
  for (const positions of vector.values()) {
    length += positions.length;
  }
  return length > 0 ? rank / (Math.log(length + 1) / Math.LN2) : rank;
}

/** A lexeme quoted as the text forms of `tsvector` and `tsquery` take it: quotes and backslashes doubled. */
function quoteLexeme(lexeme: string): string {
  return `'${lexeme.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

/** Lexemes in the order a tsvector prints them: by code point, which is byte order in UTF-8. */
function compareLexemes(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.codePointAt(index) ?? 0;
    const right = b.codePointAt(index) ?? 0;
    if (left !== right) {
      return left < right ? -1 : 1;
    }
    if (left > 0xffff) {
      index += 1;
    }
  }
  return a.length - b.length;
}

/**
 * A vector in the text form of a PostgreSQL `tsvector`, `'lexeme':1A,5B,9 'other':2`, which the
 * deployment stores with a cast and nothing else, so that what it ranks is what was built here.
 * Weight D is the default and is not written, as the server does not print it.
 */
export function serializeSearchVector(vector: SearchVector): string {
  return [...vector.entries()]
    .filter(([, positions]) => positions.length > 0)
    .sort(([a], [b]) => compareLexemes(a, b))
    .map(
      ([lexeme, positions]) =>
        `${quoteLexeme(lexeme)}:${positions
          .map(({ position, weight }) => `${position}${weight === "D" ? "" : weight}`)
          .join(",")}`,
    )
    .join(" ");
}

const WEIGHTS: ReadonlySet<string> = new Set(["A", "B", "C", "D"]);

/**
 * The vector a tsvector's text form describes, as the server prints one: the inverse of
 * {@link serializeSearchVector}, which also reads what `::text` prints of a stored vector. A
 * lexeme without positions counts as one occurrence of weight D, as `ts_rank` counts it. Text
 * that is not a tsvector yields what could be read of it.
 */
export function parseSearchVector(text: string): SearchVector {
  const vector = new Map<string, SearchPosition[]>();
  let index = 0;
  const length = text.length;
  while (index < length) {
    if (text[index] !== "'") {
      index += 1;
      continue;
    }
    index += 1;
    let lexeme = "";
    let closed = false;
    while (index < length) {
      const character = text[index] ?? "";
      if (character === "\\" && index + 1 < length) {
        lexeme += text[index + 1];
        index += 2;
      } else if (character === "'") {
        if (text[index + 1] === "'") {
          lexeme += "'";
          index += 2;
        } else {
          index += 1;
          closed = true;
          break;
        }
      } else {
        lexeme += character;
        index += 1;
      }
    }
    if (!closed || lexeme.length === 0) {
      break;
    }
    const positions: SearchPosition[] = [];
    if (text[index] === ":") {
      index += 1;
      const list = /^[0-9]+[ABCD]?(?:,[0-9]+[ABCD]?)*/.exec(text.slice(index));
      if (list !== null) {
        for (const item of list[0].split(",")) {
          const weight = item.slice(-1);
          const digits = WEIGHTS.has(weight) ? item.slice(0, -1) : item;
          positions.push({
            position: Number(digits),
            weight: WEIGHTS.has(weight) ? (weight as SearchWeight) : "D",
          });
        }
        index += list[0].length;
      }
    }
    vector.set(lexeme, positions.length === 0 ? [{ position: 0, weight: "D" }] : positions);
  }
  return vector;
}

/**
 * A query of lexemes in the text form of a PostgreSQL `tsquery`, any of which may match:
 * `'release' | 'note'`. Empty for no lexemes; the caller searches nothing then.
 */
export function serializeSearchQuery(lexemes: readonly string[]): string {
  return lexemes.map(quoteLexeme).join(" | ");
}
