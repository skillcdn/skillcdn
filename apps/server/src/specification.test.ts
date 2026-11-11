import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type Embedder,
  type FindResult,
  fragmentOf,
  headingNames,
  headingSlug,
  outlineMarkdown,
  queryIdentifiers,
  renderBrowseResult,
  renderFindResult,
} from "@skillcdn/core";
import { checkDirectory, INDEX_LIMIT_DEFAULTS, readDirectory } from "@skillcdn/indexer";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type MemorySearch,
  memoryReader,
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

describe("the specification pack, had as data (ADR-0080)", () => {
  const ANNEX = `${SET}/annex-c`;
  /** The rows the files of a folder write: every line of a table but its header and its rule. */
  const rowsWritten = (folder: string, heading?: string): string[] =>
    [...FILES]
      .filter(([path]) => path.startsWith(`${folder}/`))
      .flatMap(([, text]) => {
        const rows: string[] = [];
        let wanted = heading === undefined;
        for (const line of text.split("\n")) {
          if (line.startsWith("#")) {
            wanted = heading === undefined || line.includes(heading);
          } else if (wanted && line.startsWith("| ") && !line.startsWith("| Code |")) {
            rows.push(line);
          }
        }
        return rows;
      });

  it("answers a table that stands in three files in one read, with every row the files write", async () => {
    const { reader, mount } = await memoryReader(SPECIFICATION_PACK_PATH);
    const answer = await reader.rows(mount, { path: ANNEX, heading: "TABLE C-2" });
    if (answer.kind !== "found") throw new Error(answer.kind);
    const { result } = answer;
    const written = rowsWritten(ANNEX, "TABLE C-2");
    expect(written).toHaveLength(120);
    expect(result.rowCount).toBe(written.length);
    expect(result.nextCursor).toBeUndefined();
    // Six sections of twenty rows in three files, under one header: one table to a program.
    expect(result.tables).toHaveLength(6);
    expect(new Set(result.tables.map((table) => table.columns.join("|")))).toEqual(
      new Set(["Code|Modifier|Applies to|Report"]),
    );
    expect(new Set(result.tables.map((table) => table.path)).size).toBe(3);
    // In the order of the original, each row as the file writes it.
    const read = result.tables.flatMap((table) =>
      table.rows.map((row) => `| ${row.join(" | ")} |`),
    );
    expect(read).toEqual(written);
    expect(result.tables[0]?.heading.at(-1)).toBe("TABLE C-2 Modifier codes: AA to BZ");

    // The whole annex is the two tables: the condition codes come first, as the files do.
    const annex = await reader.rows(mount, { path: ANNEX });
    if (annex.kind !== "found") throw new Error(annex.kind);
    expect(annex.result.rowCount).toBe(132);
    expect(annex.result.tables[0]?.columns).toEqual(["Code", "Condition", "Meaning"]);
  });

  it("answers the definitions of a chapter as the code they are", async () => {
    const { reader, mount } = await memoryReader(SPECIFICATION_PACK_PATH);
    const answer = await reader.code(mount, { path: `${SET}/06-messages` });
    if (answer.kind !== "found") throw new Error(answer.kind);
    expect(answer.result.blocks.map((block) => /^(\w+) ::= /.exec(block.text)?.[1])).toEqual(
      DEFINITIONS,
    );
    expect(new Set(answer.result.blocks.map((block) => block.language))).toEqual(new Set(["tln"]));
    const one = await reader.code(mount, {
      path: `${SET}/06-messages`,
      heading: "ResumeGuardTimes",
    });
    if (one.kind !== "found") throw new Error(one.kind);
    expect(one.result.blocks).toHaveLength(1);
    expect(one.result.blocks[0]?.heading.at(-1)).toBe("6.1.8 ResumeGuardTimes");
  });

  it("says in the outline of a file of the table how many rows each section holds", async () => {
    const { reader, mount } = await memoryReader(SPECIFICATION_PACK_PATH);
    const file = [...FILES.keys()].find((path) => path.includes("table-c-2-modifier-codes-aa"));
    const answer = await reader.browse(mount, { path: file }, 0);
    if (answer.status !== "ready") throw new Error(answer.status);
    expect(answer.result.outline?.tables).toEqual({ count: 2, rows: 40 });
    expect(answer.result.outline?.headings.map((heading) => heading.rows)).toEqual([20, 20]);
  });
});

describe("the specification pack, followed by its references (ADR-0082)", () => {
  it("resolves every link that names a section, to less than half of the file it stands in", async () => {
    const { reader, mount } = await memoryReader(SPECIFICATION_PACK_PATH);
    let links = 0;
    let sectionChars = 0;
    let fileChars = 0;
    for (const [path, body] of FILES) {
      const answer = await reader.file(mount, { path, limit: 100_000 });
      if (answer.kind !== "found") throw new Error(`${path}: ${answer.kind}`);
      for (const reference of answer.file.references ?? []) {
        const fragment = fragmentOf(reference.href);
        if (fragment === undefined) continue;
        links += 1;
        const { section } = reference;
        expect(section, `${path}: ${reference.href}`).toBeDefined();
        if (section === undefined) continue;
        const target = FILES.get(reference.path) ?? "";
        const read = target.slice(section.offset, section.offset + section.length);
        // What is read begins with the heading the fragment names.
        const heading = (read.split("\n", 1)[0] ?? "").replace(/^#+\s*/, "");
        expect(headingSlug(heading).startsWith(fragment.toLowerCase()), reference.href).toBe(true);
        sectionChars += read.length;
        fileChars += target.length;
      }
      expect(body.length).toBeGreaterThan(0);
    }
    expect(links).toBeGreaterThanOrEqual(25);
    expect(sectionChars).toBeLessThan(fileChars / 2);
  });

  it("gives a clause with the clauses under it, and a clause without any as itself", async () => {
    const { reader, mount } = await memoryReader(SPECIFICATION_PACK_PATH);
    const general = `${SET}/04-link-control/010-4.1-general.md`;
    const answer = await reader.file(mount, { path: general });
    if (answer.kind !== "found") throw new Error(answer.kind);
    const resumption = answer.file.references?.find((reference) =>
      reference.href.endsWith("#4.2.6"),
    );
    const target = FILES.get(resumption?.path ?? "") ?? "";
    const section = resumption?.section ?? { offset: 0, length: 0 };
    const read = target.slice(section.offset, section.offset + section.length);
    expect(read.startsWith("### 4.2.6 Link resumption")).toBe(true);
    for (const under of ["4.2.6.1 Initiation", "4.2.6.2 Guard times", "4.2.6.3 Failure"]) {
      expect(read).toContain(`#### ${under}`);
    }
    // The outline's own length for the heading ends at the first clause under it.
    const outline = outlineMarkdown(target).headings.find((heading) =>
      heading.text.startsWith("4.2.6 "),
    );
    expect(section.length).toBeGreaterThan(outline?.length ?? Number.MAX_SAFE_INTEGER);
  });
});

describe("the notes of the specification pack (ADR-0083)", () => {
  it("quote what the clauses say, each under a link to its clause", async () => {
    const read = await readDirectory({
      directory: SPECIFICATION_PACK_PATH,
      limits: INDEX_LIMIT_DEFAULTS,
    });
    expect(read.index.diagnostics).toEqual([]);
    const note = read.index.entries.find((entry) =>
      entry.path.endsWith("notes/carrier-loss-and-resumption.md"),
    );
    expect(note?.frontMatter?.derived).toEqual({ kind: "note" });
    expect(
      note?.frontMatter?.references?.every((reference) => reference.section !== undefined),
    ).toBe(true);
  });

  it("are marked in a search result, so that an agent quotes the clause and not the note", async () => {
    const words = await memorySearch(SPECIFICATION_PACK_PATH);
    const result = await words("what a buoy keeps when it gives up");
    const note = result.items.find(
      (item) => item.kind === "document" && item.path.endsWith("carrier-loss-and-resumption.md"),
    );
    expect(note).toMatchObject({ kind: "document", derived: true });
    expect(renderFindResult(result)).toMatch(
      /document: docs\/notes\/carrier-loss-and-resumption\.md - Carrier loss and resumption \(made from other documents: quote what it points to\)/,
    );
    // A chapter is no such document.
    const chapter = result.items.find(
      (item) => item.kind === "document" && item.path.includes("/04-link-control/"),
    );
    expect(chapter === undefined || !("derived" in chapter)).toBe(true);
  });
});

describe("the original of the specification pack, kept encrypted (ADR-0084)", () => {
  const ORIGINAL = `${SET}/sources/tidewater-link-protocol-ed3.pdf`;

  it("is said to be encrypted wherever a chapter names it, with the name of its key and no more", async () => {
    const { reader, mount } = await memoryReader(SPECIFICATION_PACK_PATH);
    const chapter = `${SET}/04-link-control/030-4.2.6-link-resumption.md`;
    const outline = await reader.browse(mount, { path: chapter }, 0);
    if (outline.status !== "ready") throw new Error(outline.status);
    expect(outline.result.outline?.sources).toEqual([
      {
        text: "../sources/tidewater-link-protocol-ed3.pdf",
        path: ORIGINAL,
        url: `file:///${ORIGINAL}`,
        encrypted: true,
        keyName: "harbour-board-2026",
      },
    ]);
    expect(renderBrowseResult(outline.result)).toContain(
      `Original: ${ORIGINAL} (file:///${ORIGINAL}; encrypted, key harbour-board-2026)`,
    );
    const read = await reader.file(mount, { path: chapter });
    if (read.kind !== "found") throw new Error(read.kind);
    expect(read.file.sources?.[0]).toMatchObject({
      encrypted: true,
      keyName: "harbour-board-2026",
    });
    // A note of another set names no original, and says nothing of one.
    const note = await reader.browse(
      mount,
      { path: "docs/notes/carrier-loss-and-resumption.md" },
      0,
    );
    if (note.status !== "ready") throw new Error(note.status);
    expect(note.result.outline?.sources).toBeUndefined();
  });

  it("passes the check: the file is encrypted as its set says, and nothing of the pack holds a password", async () => {
    let report = "";
    const code = await checkDirectory({
      directory: SPECIFICATION_PACK_PATH,
      limits: INDEX_LIMIT_DEFAULTS,
      write: (text) => {
        report += text;
      },
    });
    expect(code).toBe(0);
    expect(report).toContain("Originals kept encrypted: 1 PDF as their manifest says");
    expect(report).toContain("Index diagnostics: 0");
    expect(report).not.toContain("Notes:");
  });
});
