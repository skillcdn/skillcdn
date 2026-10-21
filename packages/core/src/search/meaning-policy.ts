// Which documents of an index are embedded for the search by meaning (ADR-0064), as the
// repository manifests say: a manifest that turns the search by meaning off keeps the documents
// it governs to the words, and a nearer manifest decides for its own directory. The worker of a
// deployment and the command embedding a directory ask the same question of the same entries.

/** What the rule needs of an entry: where it is, whether it is a manifest, and what it says. */
export interface PolicyEntry {
  readonly path: string;
  readonly kind: string;
  readonly frontMatter?: { readonly search?: { readonly meaning: boolean } } | null | undefined;
}

const directoryOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/**
 * Whether each path's text is embedded, as the nearest repository manifest at or above it says:
 * false under a manifest whose `search.meaning` is off, true everywhere else.
 */
export function meaningSearchOf(entries: readonly PolicyEntry[]): (path: string) => boolean {
  const manifests = new Map<string, boolean>();
  for (const entry of entries) {
    if (entry.kind === "manifest") {
      manifests.set(directoryOf(entry.path), entry.frontMatter?.search?.meaning !== false);
    }
  }
  return (path) => {
    let directory = directoryOf(path);
    while (true) {
      const decided = manifests.get(directory);
      if (decided !== undefined) {
        return decided;
      }
      if (directory.length === 0) {
        return true;
      }
      directory = directoryOf(directory);
    }
  };
}

/** Whether an entry has sections to embed: a searchable Markdown document, or a skill's manifest, which is Markdown too. */
export function embeddable(entry: {
  readonly kind: string;
  readonly searchable: boolean;
}): boolean {
  return entry.searchable && (entry.kind === "markdown" || entry.kind === "skill");
}

/**
 * The texts in calls of what an embedder takes at once, as indexes into `texts`: at most
 * `maxTexts` texts and `maxBatchChars` characters per call, each text counted as the embedder
 * will cut it. One text alone is always a call, however long: the embedder cuts it to what it
 * embeds.
 */
export function embeddingBatches(
  texts: readonly string[],
  embedder: {
    readonly maxTexts: number;
    readonly maxBatchChars: number;
    readonly maxTextChars: number;
  },
): number[][] {
  const batches: number[][] = [];
  let batch: number[] = [];
  let chars = 0;
  texts.forEach((text, at) => {
    const length = Math.min(text.length, embedder.maxTextChars);
    if (
      batch.length > 0 &&
      (batch.length >= embedder.maxTexts || chars + length > embedder.maxBatchChars)
    ) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(at);
    chars += length;
  });
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}
