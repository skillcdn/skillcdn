import { searchLexemes, utf8Length } from "./lexemes.js";

// How a document is weighed, kept and ranked for a search: four fields, each a weight, into one
// vector of lexemes with their positions, written in the text form of a PostgreSQL `tsvector` so
// that the deployment stores it as it is and ranks it with `ts_rank`, and the command keeps and
// ranks the same vector in memory with `rankSearchVector`, which computes what `ts_rank` computes
// (ADR-0053, ADR-0063). The integration test of @skillcdn/db holds the two against each other.

/** The weight of a field, as `setweight` marks it: names first, bodies last. */
export type SearchWeight = "A" | "B" | "C" | "D";

/**
 * What each weight counts for in a rank: the array `ts_rank` is given, `{D, C, B, A}`. A match
 * in a name counts twice a match in the body, no more: with the server's steeper defaults a common
 * word in a short map's title outweighed a code in a long body, whatever the code's rarity, and
 * the two evaluation sets reached the most first documents with these (ADR-0069).
 */
export const SEARCH_WEIGHTS: Readonly<Record<SearchWeight, number>> = {
  A: 1.0,
  B: 0.85,
  C: 0.7,
  D: 0.5,
};

/** How the weights rank when one position is kept of several: A above D. */
const WEIGHT_RANK: Readonly<Record<SearchWeight, number>> = { A: 3, B: 2, C: 1, D: 0 };

/** Characters of a body that go into the search vector, before the vector's own bound in bytes. */
export const MAX_SEARCHED_BODY_LENGTH = 200_000;

/**
 * The bytes a tsvector has for its lexemes and positions, which no stored vector may exceed: a
 * document's words past where they would fill it are left out of its vector, as its characters
 * past {@link MAX_SEARCHED_BODY_LENGTH} are.
 */
export const MAX_VECTOR_BYTES = 1_048_575;

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
 * Whether a tsvector keeps one more position of a lexeme, given those kept so far: positions
 * arrive ascending and are kept each once, at most 256 of them, and none after the last position,
 * which every later word shares.
 */
function keeps(positions: readonly SearchPosition[], at: number): boolean {
  const last = positions[positions.length - 1];
  return (
    last === undefined ||
    (positions.length < MAX_POSITIONS_PER_LEXEME &&
      last.position !== MAX_POSITION &&
      last.position !== at)
  );
}

/** Adds a position as a tsvector keeps them; a repeated position keeps the highest weight it was seen with. */
function addPosition(positions: SearchPosition[], candidate: SearchPosition): void {
  if (keeps(positions, candidate.position)) {
    positions.push(candidate);
    return;
  }
  const last = positions[positions.length - 1];
  if (
    last !== undefined &&
    last.position === candidate.position &&
    positions.length < MAX_POSITIONS_PER_LEXEME &&
    last.position !== MAX_POSITION &&
    WEIGHT_RANK[candidate.weight] > WEIGHT_RANK[last.weight]
  ) {
    positions[positions.length - 1] = candidate;
  }
}

/** What a lexeme takes in a tsvector besides its positions: its bytes, rounded up to an even number, and the count of its positions. */
function lexemeBytes(lexeme: string): number {
  const length = utf8Length(lexeme);
  return length + (length % 2) + 2;
}

/** What one position takes in a tsvector. */
const POSITION_BYTES = 2;

/**
 * The vector of a document: the lexemes of every field, weighted, with the positions of a later
 * field continuing after the last position of the one before, as `||` joins vectors, up to the
 * bytes a tsvector holds. `language` is the pack's, and chooses the word rules the fields are
 * read with.
 */
export function searchVectorOf(fields: readonly SearchField[], language?: string): SearchVector {
  const vector = new Map<string, SearchPosition[]>();
  let bytes = 0;
  let offset = 0;
  for (const field of fields) {
    let last = 0;
    for (const { lexeme, position } of searchLexemes(field.text, language)) {
      const at = Math.min(offset + position, MAX_POSITION);
      last = Math.max(last, position);
      let positions = vector.get(lexeme);
      // What this word adds to the tsvector, as the server lays it out. Past the bytes a tsvector
      // has, the rest of the document is not searched: the server would reject the whole vector.
      const cost =
        (positions === undefined ? lexemeBytes(lexeme) : 0) +
        (positions === undefined || keeps(positions, at) ? POSITION_BYTES : 0);
      if (bytes + cost > MAX_VECTOR_BYTES) {
        return vector;
      }
      bytes += cost;
      if (positions === undefined) {
        positions = [];
        vector.set(lexeme, positions);
      }
      addPosition(positions, { position: at, weight: field.weight });
    }
    offset = Math.min(offset + last, MAX_POSITION);
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
 *
 * Given `weights`, one per lexeme of the query, the average is weighed (ADR-0069): a lexeme's
 * occurrences count its weight's share, and the sum is divided by the sum of the weights, which
 * is the average `ts_rank` computes when every weight is one. A deployment computes the same as
 * the weighed mean of `ts_rank` over each lexeme alone.
 */
export function rankSearchVector(
  vector: SearchVector,
  query: readonly string[],
  weights?: readonly number[],
): number {
  if (query.length === 0 || vector.size === 0) {
    return 0;
  }
  let rank = 0;
  let total = 0;
  for (const [at, lexeme] of query.entries()) {
    const weight = weights?.[at] ?? 1;
    total += weight;
    const positions = vector.get(lexeme);
    if (positions === undefined) {
      continue;
    }
    let sum = 0;
    let best = -1;
    let bestAt = 0;
    positions.forEach(({ weight: field }, index) => {
      const value = SEARCH_WEIGHTS[field];
      sum += value / ((index + 1) * (index + 1));
      if (value > best) {
        best = value;
        bestAt = index;
      }
    });
    rank += (weight * (best + sum - best / ((bestAt + 1) * (bestAt + 1)))) / BASEL;
  }
  if (rank === 0 || total <= 0) {
    return 0;
  }
  rank /= total;
  let length = 0;
  for (const positions of vector.values()) {
    length += positions.length;
  }
  return length > 0 ? rank / (Math.log(length + 1) / Math.LN2) : rank;
}

/**
 * How much each lexeme of a query counts, by its rarity among the `total` findable entries of
 * the mount, `frequencies` being how many of them hold each lexeme (ADR-0069): the fewer entries
 * hold a word, the more a match of it says. The weight is the inverse document frequency as BM25
 * smooths it, ln(1 + (N - n + 0.5) / (n + 0.5)), so that a word in every entry weighs next to
 * nothing and still ranks the entries that hold only it above those that hold nothing of the
 * query. Every lexeme weighs one where nothing was counted.
 */
export function queryWeights(total: number, frequencies: readonly number[]): number[] {
  if (total <= 0) {
    return frequencies.map(() => 1);
  }
  return frequencies.map((count) => {
    const held = Math.min(Math.max(count, 0), total);
    return Math.log(1 + (total - held + 0.5) / (held + 0.5));
  });
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
