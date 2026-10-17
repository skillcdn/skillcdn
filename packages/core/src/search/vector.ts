import { type Lexeme, searchLexemes } from "./lexemes.js";

// How a document is weighed and ranked for a search, as the deployment's index does it in SQL
// (`writeSnapshotIndex` and `searchEntries` in @skillcdn/db): four fields, each a weight, and
// `ts_rank` over them with its logarithmic normalization. The order a search comes out in may
// still differ between an index in memory and PostgreSQL's (ADR-0053); what matches does not.

/** The weight of a field, as `setweight` marks it: names first, bodies last. */
export type SearchWeight = "A" | "B" | "C" | "D";

/** What each weight counts for in a rank: the array `ts_rank` is given, `{D, C, B, A}`. */
export const SEARCH_WEIGHTS: Readonly<Record<SearchWeight, number>> = {
  A: 1.0,
  B: 0.6,
  C: 0.2,
  D: 0.05,
};

/** Characters of a body that go into the search vector: a tsvector is limited to 1 MB. */
export const MAX_SEARCHED_BODY_LENGTH = 200_000;

/** Skills outrank plain documents by this much. */
export const SKILL_RANK_BOOST = 1.5;

/** One position a lexeme occurs at, and the weight of the field it occurred in. */
export interface SearchPosition {
  readonly position: number;
  readonly weight: SearchWeight;
}

/** A document ready to be searched: every lexeme with where it occurs. */
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
 * The four fields of an index entry, as the deployment weighs them: the name and the title,
 * the description, the words of the path, and the searched body. `undefined` for an entry that
 * is not searched.
 */
export function searchFieldsOf(
  entry: {
    readonly path: string;
    readonly name?: string | undefined;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly searchBody?: string | undefined;
  },
  body: string | undefined,
): SearchField[] {
  return [
    { weight: "A", text: `${entry.name ?? ""} ${entry.title ?? ""}` },
    { weight: "B", text: entry.description ?? "" },
    { weight: "C", text: entry.path.replaceAll(/[/._-]/gu, " ") },
    { weight: "D", text: (entry.searchBody ?? body ?? "").slice(0, MAX_SEARCHED_BODY_LENGTH) },
  ];
}

/**
 * The vector of a document: the lexemes of every field, weighted, with the positions of a later
 * field continuing after the last position of the one before, as `||` joins vectors.
 */
export function searchVectorOf(fields: readonly SearchField[]): SearchVector {
  const vector = new Map<string, SearchPosition[]>();
  let offset = 0;
  for (const field of fields) {
    const lexemes: Lexeme[] = searchLexemes(field.text);
    let last = 0;
    for (const { lexeme, position } of lexemes) {
      const at = Math.min(offset + position, MAX_POSITION);
      last = Math.max(last, position);
      let positions = vector.get(lexeme);
      if (positions === undefined) {
        positions = [];
        vector.set(lexeme, positions);
      }
      if (positions.length < MAX_POSITIONS_PER_LEXEME) {
        positions.push({ position: at, weight: field.weight });
      }
    }
    offset = Math.min(offset + last, MAX_POSITION);
  }
  for (const positions of vector.values()) {
    positions.sort((a, b) => a.position - b.position);
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
