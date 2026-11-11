import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type Embedder,
  type FindResult,
  headingNames,
  outlineMarkdown,
  queryIdentifiers,
} from "@skillcdn/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type MemorySearch,
  memorySearch,
  memorySearchWithMeaning,
  SPECIFICATION_PACK_PATH,
} from "./retrieval/evaluate.js";

// The specification pack, searched as an agent searches a long specification (ADR-0078,
// ADR-0079): by the number of a clause, the name of a table, the identifier of a definition, and
// one word of a term its tables join with slashes or dots. The questions are made from the pack
// itself, so they hold for whatever the fixture comes to say. The search by meaning is on
// throughout, with an embedder that knows nothing of numbers and names, as a real one knows
// little: what is held here is that such a query is answered as the words alone answer it.

const SET = "docs/link-protocol";

/** Every Markdown file of the set by its repository path, with its text. */
function filesOf(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const relative = `${prefix}/${name}`;
      if (statSync(absolute).isDirectory()) {
        walk(absolute, relative);
      } else if (name.endsWith(".md")) {
        files.set(relative, readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(join(root, ...SET.split("/")), SET);
  return files;
}

const FILES = filesOf(SPECIFICATION_PACK_PATH);
/** The chapters: what the original says, without the maps and the index made from it. */
const CHAPTERS = [...FILES].filter(
  ([path]) => !path.endsWith("/README.md") && !path.includes("/index/"),
);

/** The headings of the chapters, each with the file it stands in. */
const HEADINGS = CHAPTERS.flatMap(([path, text]) =>
  outlineMarkdown(text).headings.map((heading) => ({ path, text: heading.text })),
);

/** The files one of whose headings names an identifier. */
const headedBy = (identifier: string): Set<string> =>
  new Set(
    [...FILES]
      .filter(([, text]) =>
        outlineMarkdown(text).headings.some((heading) => headingNames(heading.text, identifier)),
      )
      .map(([path]) => path),
  );

const NUMBERS = HEADINGS.flatMap(({ path, text }) => {
  const number = /^(\d+(?:\.\d+)+)\s/.exec(text)?.[1];
  return number === undefined ? [] : [{ query: number, title: text, path }];
});
const TABLES = [
  ...new Set(HEADINGS.flatMap(({ text }) => /^(TABLE [A-Z]-\d+)\b/.exec(text)?.[1] ?? [])),
];
const DEFINITIONS = [
  ...new Set(
    CHAPTERS.flatMap(([, text]) => [...text.matchAll(/^(\w+) ::= /gm)].map((match) => match[1])),
  ),
].filter((name): name is string => name !== undefined);

/** The terms a table row joins with slashes or dots, and the words found nowhere else by themselves. */
const JOINED = (() => {
  const all = [...FILES.values()].join("\n");
  const parts = new Map<string, Set<string>>();
  for (const [path, text] of CHAPTERS) {
    for (const line of text.split("\n").filter((row) => row.startsWith("|"))) {
      for (const term of line.match(/[A-Za-z]{2,}(?:[/.][A-Za-z]{2,})+/g) ?? []) {
        for (const part of term.split(/[/.]/)) {
          const alone = new RegExp(`(?<![/.A-Za-z])${part}(?![/.A-Za-z])`, "i");
          if (!alone.test(all)) {
            const holders = parts.get(part.toLowerCase()) ?? new Set<string>();
            holders.add(path);
            parts.set(part.toLowerCase(), holders);
          }
        }
      }
    }
  }
  return parts;
})();

/** A bag of words as a vector: letters only, so a number is nothing to it and a name one word among many. */
function bagOfWords(synonyms: Readonly<Record<string, string>> = {}): Embedder {
  const dimensions = 64;
  const vectorOf = (text: string): Float32Array => {
    const vector = new Float32Array(dimensions);
    for (const token of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      const word = synonyms[token] ?? token;
      const at = (createHash("sha1").update(word).digest()[0] ?? 0) % dimensions;
      vector[at] = (vector[at] ?? 0) + 1;
    }
    return vector;
  };
  return {
    model: "bag-of-words",
    dimensions,
    maxTexts: 16,
    maxTextChars: 8000,
    maxBatchChars: 32_000,
    embed: async (texts) => ({ vectors: texts.map(vectorOf), tokens: 0 }),
  };
}

const firstOf = (result: FindResult): string | undefined => {
  const first = result.items[0];
  return first?.kind === "document" ? first.path : undefined;
};

describe("the specification pack, searched by words and meaning", () => {
  let words: MemorySearch;
  let both: MemorySearch;

  beforeAll(async () => {
    words = await memorySearch(SPECIFICATION_PACK_PATH);
    both = (
      await memorySearchWithMeaning(
        { embedder: bagOfWords({ noticing: "detection", vanished: "loss", signal: "carrier" }) },
        SPECIFICATION_PACK_PATH,
      )
    ).find;
  });

  it("has enough of every kind of question to mean something", () => {
    expect(NUMBERS.length).toBeGreaterThanOrEqual(20);
    expect(TABLES).toEqual(["TABLE C-1", "TABLE C-2"]);
    expect(DEFINITIONS.length).toBe(12);
    expect(JOINED.size).toBeGreaterThanOrEqual(40);
  });

  it("answers the number of a clause with the file that holds the clause, as the words alone do", async () => {
    for (const { query, path } of NUMBERS) {
      const result = await both(query);
      expect(firstOf(result), query).toBe(path);
      expect(firstOf(await words(query)), query).toBe(path);
      expect(result.ranking, query).toEqual({ meaning: false, reranked: false, identifiers: true });
    }
  });

  it("answers a number with its title the same way, with meaning taking part", async () => {
    for (const { title, path } of NUMBERS) {
      const result = await both(title);
      expect(firstOf(result), title).toBe(path);
      // A title that is itself a name (`6.1.1 LinkSetupRequest`) is identifiers alone.
      expect(result.ranking?.identifiers, title).toBe(
        queryIdentifiers(title).only ? true : undefined,
      );
    }
  });

  it("answers the name of a table with a file that holds rows of it", async () => {
    for (const table of TABLES) {
      const holders = new Set(
        HEADINGS.filter(({ text }) => text.startsWith(table)).map((h) => h.path),
      );
      const result = await both(table);
      expect(holders.has(firstOf(result) ?? ""), table).toBe(true);
      expect(firstOf(result), table).toBe(firstOf(await words(table)));
    }
  });

  it("answers the name of a definition with a file one of whose headings names it", async () => {
    for (const name of DEFINITIONS) {
      const result = await both(name);
      expect(headedBy(name).has(firstOf(result) ?? ""), name).toBe(true);
      expect(firstOf(result), name).toBe(firstOf(await words(name)));
    }
  });

  it("finds a term joined by slashes or dots by one word of it", async () => {
    for (const [part, holders] of JOINED) {
      const result = await words(part);
      const found = result.items.flatMap((item) => (item.kind === "document" ? [item.path] : []));
      expect(
        found.some((path) => holders.has(path)),
        part,
      ).toBe(true);
      // A word one row holds, and no other text, names that row's file first.
      if (holders.size === 1) {
        expect(found[0], part).toBe([...holders][0]);
      }
    }
  });

  it("answers a question in other words by its meaning, as before", async () => {
    // None of these words is in the pack; the embedder knows what they mean.
    const result = await both("noticing a vanished signal");
    expect(result.ranking).toEqual({ meaning: true, reranked: false });
    expect(firstOf(result)).toBe(`${SET}/04-link-control/040-4.2.7-to-4.2.8-carrier-loss.md`);
    expect((await words("noticing a vanished signal")).items).toEqual([]);
  });
});
