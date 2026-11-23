// Reciprocal rank fusion (ADR-0063, point 5): how the results of a search by words and the
// results of a search by meaning become one order without a common score. Each list gives every
// key it holds 1 / (k + rank), rank counted from 1, and a key's score is the sum over the lists;
// k keeps a first place in one list from outweighing presence in both.

/** The constant of the fusion: the value the literature settled on. */
export const RRF_K = 60;

export interface FusionOptions<K> {
  /** In place of {@link RRF_K}. */
  readonly k?: number | undefined;
  /** A factor on a key's fused score, such as the boost a skill gets over a document. */
  readonly boost?: ((key: K) => number) | undefined;
  /** How keys of the same score are ordered; left out, the order they were first seen in. */
  readonly compare?: ((a: K, b: K) => number) | undefined;
  /**
   * Whether the list at `list`, counted from 0, could not have held a key, whatever it ranks
   * by: the list by meaning, of an entry that has no vector yet (ADR-0126). A list that leaves
   * such a key out has not said that the key is far, so it counts the key at the best place
   * another list gave it, where it would count nothing.
   */
  readonly unplaced?: ((key: K, list: number) => boolean) | undefined;
}

/**
 * The keys of `lists` in one order, best first: by the sum over the lists of 1 / (k + rank), a key
 * counted once per list at its first rank there, times its boost. A list that could not have
 * held a key (`unplaced`) counts it at its best rank among the others. Ties keep the order the
 * keys were first seen in, unless `compare` says otherwise.
 */
export function fuseRanks<K>(
  lists: readonly (readonly K[])[],
  options: FusionOptions<K> = {},
): K[] {
  const k = options.k ?? RRF_K;
  /** The rank each list gives the keys it holds, from 1, at a key's first place there. */
  const ranks = lists.map((list) => {
    const placed = new Map<K, number>();
    list.forEach((key, index) => {
      if (!placed.has(key)) {
        placed.set(key, index + 1);
      }
    });
    return placed;
  });
  const scores = new Map<K, number>();
  for (const placed of ranks) {
    for (const [key, rank] of placed) {
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + rank));
    }
  }
  const unplaced = options.unplaced;
  if (unplaced !== undefined) {
    for (const key of scores.keys()) {
      const held = ranks.flatMap((placed) => placed.get(key) ?? []);
      const best = Math.min(...held);
      ranks.forEach((placed, list) => {
        if (!placed.has(key) && unplaced(key, list)) {
          scores.set(key, (scores.get(key) ?? 0) + 1 / (k + best));
        }
      });
    }
  }
  const boost = options.boost;
  const compare = options.compare;
  return [...scores.entries()]
    .map(([key, score]) => ({ key, score: boost === undefined ? score : score * boost(key) }))
    .sort((a, b) => b.score - a.score || (compare === undefined ? 0 : compare(a.key, b.key)))
    .map((item) => item.key);
}
