/**
 * Scores how well each of some candidate texts answers a query (ADR-0065). A search by words and by
 * meaning fuses its results and has the first of them reranked before the page is cut; a reranker
 * that does not answer in time is left out of that search, so a call fails rather than waits.
 */
export interface Reranker {
  /** The model's id. */
  readonly model: string;
  /** The most candidates one call takes. */
  readonly maxCandidates: number;
  /**
   * One score per candidate, in the candidates' order: higher is more relevant. Scores are
   * comparable within one call and mean nothing across calls or models.
   */
  rerank(query: string, candidates: readonly string[]): Promise<readonly number[]>;
}
