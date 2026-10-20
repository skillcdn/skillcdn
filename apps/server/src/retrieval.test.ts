import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { outlineMarkdown } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PACK_PATH,
  evaluateRetrieval,
  formatRetrievalReport,
  loadRetrievalSet,
  memorySearch,
  scoreOfLanguage,
} from "./retrieval/evaluate.js";

// The lexical baseline of the retrieval evaluation set (ADR-0063), over the command's index in
// memory: the numbers search by words alone reached when the set was written (2026-10, reading
// rules version 11): English 76% file@1, 100% file@5, 91% section@1, 100% section@2; Korean 88%,
// 100%, 76%, 100%. A change to the word rules or the ranking that lowers them is a regression; a
// model that raises them is what phase B is measured by. The floors are a little under the
// numbers measured, so that a tie broken the other way does not fail the build.

const FLOORS = {
  en: { fileAt1: 0.65, fileAt5: 0.95, sectionAt2: 0.9 },
  ko: { fileAt1: 0.75, fileAt5: 0.95, sectionAt2: 0.9 },
};

describe("the retrieval evaluation set", () => {
  const set = loadRetrievalSet();

  it("names documents and sections the fixture has", () => {
    const walk = (directory: string, prefix: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const absolute = join(directory, name);
        const relative = prefix.length === 0 ? name : `${prefix}/${name}`;
        return statSync(absolute).isDirectory() ? walk(absolute, relative) : [relative];
      });
    const files = new Set(walk(DOCUMENT_PACK_PATH, ""));
    for (const question of set.questions) {
      for (const answer of question.answers) {
        expect(files.has(answer.path), `${question.id}: ${answer.path}`).toBe(true);
        const text = readFileSync(join(DOCUMENT_PACK_PATH, ...answer.path.split("/")), "utf8");
        const headings = outlineMarkdown(text).headings.map((heading) => heading.text);
        const last = answer.heading[answer.heading.length - 1];
        expect(headings, `${question.id}: ${answer.heading.join(" > ")}`).toContain(last);
      }
    }
    expect(new Set(set.questions.map((question) => question.id)).size).toBe(set.questions.length);
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
});
