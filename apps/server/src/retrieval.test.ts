import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Embedder, outlineMarkdown } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PACK_PATH,
  evaluateRetrieval,
  formatRetrievalReport,
  loadRetrievalSet,
  MULTILINGUAL_PACK_PATH,
  MULTILINGUAL_SET_PATH,
  memorySearch,
  memorySearchWithMeaning,
  QUESTION_KINDS,
  type RetrievalScore,
  scoreOf,
  scoreOfLanguage,
} from "./retrieval/evaluate.js";

// The lexical baseline of the retrieval evaluation set (ADR-0063), over the command's index in
// memory: the numbers search by words alone reaches (2026-10-23, reading rules version 12, each
// word weighed by its rarity, ADR-0069): English 91% file@1, 100% file@5, 97% section@1, 100%
// section@2; Korean 100%, 100%, 88%, 100%. A change to the word rules or the ranking that lowers
// them is a regression; a model that raises them is what phase B is measured by. The floors are a
// little under the numbers measured, so that a tie broken the other way does not fail the build.

const FLOORS = {
  en: { fileAt1: 0.85, fileAt5: 0.95, sectionAt2: 0.95 },
  ko: { fileAt1: 0.9, fileAt5: 0.95, sectionAt2: 0.95 },
};

describe("the retrieval evaluation set", () => {
  const set = loadRetrievalSet();

  it("names documents and sections the fixture has", () => {
    expectAnswersInPack(set, DOCUMENT_PACK_PATH);
  });

  it("holds the lexical baseline, in English and in Korean", async () => {
    const find = await memorySearch();
    const score = await evaluateRetrieval(set, (question) => find(question.query));
    const report = formatRetrievalReport(score);
    for (const language of ["en", "ko"] as const) {
      const part = scoreOfLanguage(score, language);
      expect(part.questions, language).toBeGreaterThan(0);
      expect(part.fileAt1, `${language} file@1\n${report}`).toBeGreaterThanOrEqual(
        FLOORS[language].fileAt1,
      );
      expect(part.fileAt5, `${language} file@5\n${report}`).toBeGreaterThanOrEqual(
        FLOORS[language].fileAt5,
      );
      expect(part.sectionAt2, `${language} section@2\n${report}`).toBeGreaterThanOrEqual(
        FLOORS[language].sectionAt2,
      );
    }
  });

  it("names the sections of a document result with what reads them", async () => {
    const find = await memorySearch();
    const result = await find("waive a late fee");
    const first = result.items[0];
    expect(first?.kind).toBe("document");
    if (first?.kind !== "document") throw new Error("not a document");
    expect(first.path).toBe("docs/invoicing.md");
    const section = first.sections?.[0];
    expect(section?.heading).toEqual(["Invoicing", "Late fees"]);
    const text = readFileSync(join(DOCUMENT_PACK_PATH, "docs", "invoicing.md"), "utf8");
    const read = text.slice(section?.offset, (section?.offset ?? 0) + (section?.length ?? 0));
    expect(read.startsWith("## Late fees")).toBe(true);
    expect(read).toContain("a bookkeeper can waive a fee");
    // The excerpt is the prose that holds the most of the words asked for.
    expect(section?.excerpt).toContain("late fee");
  });

  it("runs by words and meaning with an embedder, as a profile is measured", async () => {
    // A bag of words as a vector, with a few words that mean another: what the words miss, the
    // embedder finds, and the search says that meaning took part.
    const synonyms: Readonly<Record<string, string>> = { pardon: "waive", tardy: "late" };
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
    let documents = 0;
    const embedder: Embedder = {
      model: "bag-of-words",
      dimensions,
      maxTexts: 16,
      maxTextChars: 8000,
      maxBatchChars: 32_000,
      async embed(texts, as) {
        if (as === "document") documents += texts.length;
        return { vectors: texts.map(vectorOf), tokens: 0 };
      },
    };
    const { find, embedded } = await memorySearchWithMeaning({ embedder });
    expect(embedded.bodies).toBeGreaterThan(0);
    expect(embedded.sections).toBe(documents);
    expect(embedded.milliseconds).toBeGreaterThanOrEqual(0);
    const result = await find("pardon a tardy fee");
    expect(result.ranking).toEqual({ meaning: true, reranked: false });
    expect(result.items[0]).toMatchObject({ kind: "document", path: "docs/invoicing.md" });
  });
});

/** The files of a pack, by their repository paths. */
const filesOf = (root: string): Set<string> => {
  const walk = (directory: string, prefix: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const absolute = join(directory, name);
      const relative = prefix.length === 0 ? name : `${prefix}/${name}`;
      return statSync(absolute).isDirectory() ? walk(absolute, relative) : [relative];
    });
  return new Set(walk(root, ""));
};

/** Every answer of the set names a file of the pack and a heading that file has; every id is one question's. */
function expectAnswersInPack(set: ReturnType<typeof loadRetrievalSet>, root: string): void {
  const files = filesOf(root);
  for (const question of set.questions) {
    for (const answer of question.answers) {
      expect(files.has(answer.path), `${question.id}: ${answer.path}`).toBe(true);
      const text = readFileSync(join(root, ...answer.path.split("/")), "utf8");
      const headings = outlineMarkdown(text).headings.map((heading) => heading.text);
      const last = answer.heading[answer.heading.length - 1];
      expect(headings, `${question.id}: ${answer.heading.join(" > ")}`).toContain(last);
    }
  }
  expect(new Set(set.questions.map((question) => question.id)).size).toBe(set.questions.length);
}

// The second set (ADR-0063): the library of an invented federation in six languages, in the
// vocabulary of research and defense documents, which the first set does not reach: scripts
// matched by pairs of characters (Japanese and Chinese beside Korean), languages read without a
// stemmer (German and Russian), questions in another language than their document, which words
// alone cannot answer, and codes asked verbatim, which words must not lose. The floors are the
// lexical baseline (2026-10-23, reading rules version 12, each word weighed by its rarity and a
// hyphenated code a word of its own, ADR-0069): by the language of the question, file@1 from 43%
// (German) to 67% (Russian), file@5 from 73% to 80%, section@2 from 43% to 67%; the codes asked
// verbatim 86% file@1 and 97% file@5; nothing across languages. The floors are a little under the
// numbers, so that a tie broken the other way does not fail the build.

const MULTILINGUAL_FLOORS: Readonly<
  Record<string, { fileAt1: number; fileAt5: number; sectionAt2: number }>
> = {
  en: { fileAt1: 0.5, fileAt5: 0.7, sectionAt2: 0.5 },
  ko: { fileAt1: 0.45, fileAt5: 0.7, sectionAt2: 0.5 },
  ja: { fileAt1: 0.55, fileAt5: 0.7, sectionAt2: 0.5 },
  zh: { fileAt1: 0.55, fileAt5: 0.7, sectionAt2: 0.6 },
  de: { fileAt1: 0.35, fileAt5: 0.65, sectionAt2: 0.35 },
  ru: { fileAt1: 0.6, fileAt5: 0.7, sectionAt2: 0.5 },
};
/** What the words alone reach on the codes asked verbatim. */
const EXACT_TERM_FLOOR = { fileAt1: 0.8, fileAt5: 0.9 };
/** What they reach at most across languages: the codes and names the two languages share. */
const CROSS_CEILING = { fileAt5: 0.1 };

describe("the multilingual retrieval evaluation set", () => {
  const set = loadRetrievalSet(MULTILINGUAL_SET_PATH);
  const languages = ["en", "ko", "ja", "zh", "de", "ru"];

  it("names documents and sections the pack has, with the language and the domain of each", () => {
    expectAnswersInPack(set, MULTILINGUAL_PACK_PATH);
    for (const question of set.questions) {
      expect(QUESTION_KINDS, question.id).toContain(question.kind);
      expect(["research", "defense"], question.id).toContain(question.domain);
      for (const answer of question.answers) {
        const [language, docs, domain] = answer.path.split("/");
        expect(docs, question.id).toBe("docs");
        expect(answer.language, question.id).toBe(language);
        expect(question.domain, question.id).toBe(domain);
        // A question in another language than its document is a cross question, and only one.
        expect(language !== question.language, question.id).toBe(question.kind === "cross");
      }
    }
  });

  it("is as large as it was designed to be", () => {
    const count = (pick: (question: (typeof set.questions)[number]) => boolean): number =>
      set.questions.filter(pick).length;
    expect(set.questions.length).toBeGreaterThanOrEqual(150);
    for (const language of languages) {
      expect(
        count((question) => question.language === language),
        language,
      ).toBeGreaterThanOrEqual(20);
      expect(
        count((question) => question.answers.some((answer) => answer.language === language)),
        `documents in ${language}`,
      ).toBeGreaterThanOrEqual(20);
    }
    expect(count((question) => question.kind === "cross")).toBeGreaterThanOrEqual(30);
    expect(count((question) => question.kind === "exact-term")).toBeGreaterThanOrEqual(20);
  });

  it("holds the lexical baseline in every language and on the codes asked verbatim, and no more across languages", async () => {
    const find = await memorySearch(MULTILINGUAL_PACK_PATH);
    const score = await evaluateRetrieval(set, (question) => find(question.query));
    const report = formatRetrievalReport(score);
    const atLeast = (part: RetrievalScore, floor: Partial<RetrievalScore>, label: string): void => {
      for (const [key, value] of Object.entries(floor) as [keyof RetrievalScore, number][]) {
        expect(part[key], `${label} ${key}\n${report}`).toBeGreaterThanOrEqual(value);
      }
    };
    for (const language of languages) {
      const part = scoreOfLanguage(score, language);
      expect(part.questions, language).toBeGreaterThan(0);
      atLeast(part, MULTILINGUAL_FLOORS[language] ?? {}, language);
    }
    atLeast(
      scoreOf(score, (outcome) => outcome.kind === "exact-term"),
      EXACT_TERM_FLOOR,
      "exact-term",
    );
    // Words alone cannot read a question in another language than the document: what reaches the
    // page there is the codes and names the two share, and the rest is what meaning adds.
    const cross = scoreOf(score, (outcome) => outcome.kind === "cross");
    expect(cross.fileAt5, `cross\n${report}`).toBeLessThanOrEqual(CROSS_CEILING.fileAt5);
  });
});
