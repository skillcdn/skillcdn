/**
 * Turns texts into vectors of their meaning, for the search by meaning (ADR-0064, ADR-0065): the
 * sections of a document once a commit is indexed, and a query when an agent searches. A query is
 * embedded with the task instruction the model expects in front of it and a document with none,
 * so the caller says which of the two it sends, and the adapter adds the instruction from its
 * configuration.
 *
 * A vector is keyed by the model that made it: a change of model is a new key and a backfill, never
 * a schema change, so every vector of a deployment has the same `dimensions`, whatever its model.
 *
 * What one call takes is the adapter's to say, from its configuration: a caller with more texts
 * makes more calls, packed within the three bounds, and the adapter sees that no more than a few
 * calls are in flight at once, so that a burst of searches or a worker with a large pack does not
 * pile onto the server behind it.
 */
export interface Embedder {
  /** The model's id, as the vectors are keyed by it. */
  readonly model: string;
  /** How many numbers every vector has. */
  readonly dimensions: number;
  /** The most texts one call takes. */
  readonly maxTexts: number;
  /**
   * The most characters of one text that are embedded: a longer text is cut there, and its vector
   * is the vector of its beginning.
   */
  readonly maxTextChars: number;
  /** The most characters one call takes, summed over its texts once each is cut. */
  readonly maxBatchChars: number;
  /** One vector per text, in the texts' order. */
  embed(texts: readonly string[], as: EmbeddingRole): Promise<Embeddings>;
}

/** What the texts are to the model: the documents that are searched, or the query that searches. */
export type EmbeddingRole = "document" | "query";

export interface Embeddings {
  /** One per text, in the texts' order, each of the embedder's `dimensions`. */
  readonly vectors: readonly Float32Array[];
  /**
   * The tokens the model read, as the server counted them, for whoever meters a deployment
   * (ADR-0064); `undefined` when the server did not say.
   */
  readonly tokens: number | undefined;
}
