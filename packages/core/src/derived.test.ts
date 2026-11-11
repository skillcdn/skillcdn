import { describe, expect, it } from "vitest";
import {
  documentDerivation,
  foldQuoted,
  MAX_QUOTATIONS,
  quotationStandsIn,
  quotationsOf,
} from "./derived.js";

const lines = (...text: string[]): string => text.join("\n");

describe("documentDerivation", () => {
  it("reads what a document says of how it was made", () => {
    const text = lines(
      "---",
      "title: Notes on carrier loss",
      "derived:",
      "  kind: note",
      "  from:",
      "    - ../link-protocol",
      "    - /docs/other.md",
      "  by: a run of the research skill",
      "  at: 2026-11-11",
      "---",
      "# Notes",
    );
    expect(documentDerivation(text)).toEqual({
      kind: "note",
      from: ["../link-protocol", "/docs/other.md"],
      by: "a run of the research skill",
      at: "2026-11-11",
    });
    expect(documentDerivation("---\nderived:\n  from: ../set\n---\n")).toEqual({
      kind: undefined,
      from: ["../set"],
      by: undefined,
      at: undefined,
    });
    // A word alone is the kind; `true` says only that it is derived.
    expect(documentDerivation("---\nderived: glossary\n---\n")?.kind).toBe("glossary");
    expect(documentDerivation("---\nderived: true\n---\n")).toEqual({
      kind: undefined,
      from: [],
      by: undefined,
      at: undefined,
    });
  });

  it("answers nothing for a document that does not say it is derived", () => {
    for (const text of [
      "# Plain\n",
      "---\ntitle: Plain\n---\n",
      "---\nderived: false\n---\n",
      "---\nderived: no\n---\n",
      "---\nderived:\n---\n",
      "---\nderived: [a, b]\n---\n",
      "---\nderived: {unclosed\n---\n",
      "",
    ]) {
      expect(documentDerivation(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});

describe("quotationsOf", () => {
  it("reads each block quote as its text and the line that names its source", () => {
    const text = lines(
      "---",
      "derived: note",
      "---",
      "## When the carrier counts as lost",
      "",
      "> At the count maxSilentWindows the carrier is lost.",
      "> A single window of noise is no loss.",
      ">",
      "> — [4.2.7](../chapter.md#4.2.7)",
      "",
      "Between them, prose.",
      "",
      ">One line, no space after the marker.",
      "> — [4.2.8](../chapter.md#4.2.8)",
    );
    expect(quotationsOf(text)).toEqual([
      {
        offset: text.indexOf("> At the count"),
        text: "At the count maxSilentWindows the carrier is lost.\nA single window of noise is no loss.",
        source: "— [4.2.7](../chapter.md#4.2.7)",
      },
      {
        offset: text.indexOf(">One line"),
        text: "One line, no space after the marker.",
        source: "— [4.2.8](../chapter.md#4.2.8)",
      },
    ]);
  });

  it("takes a block of one line as its own source line, and looks into no code", () => {
    expect(quotationsOf("> Only a line.\n")).toEqual([
      { offset: 0, text: "", source: "Only a line." },
    ]);
    expect(quotationsOf("```\n> not a quote\n```\n")).toEqual([]);
    expect(quotationsOf("---\nnote: |\n  > in the front-matter\n---\nBody.\n")).toEqual([]);
    expect(quotationsOf("")).toEqual([]);
  });

  it("looks at a bounded number of block quotes, in time that grows with the text", () => {
    const many = "> a\n\n".repeat(MAX_QUOTATIONS + 50);
    expect(quotationsOf(many)).toHaveLength(MAX_QUOTATIONS);
    expect(quotationsOf(">".repeat(200_000))).toHaveLength(1);
    expect(quotationsOf("> \n".repeat(100_000))).toHaveLength(1);
  }, 60_000);
});

describe("quotationStandsIn", () => {
  const source = lines(
    "### 4.2.7 Detection of carrier loss",
    "",
    "A shore station counts the windows in which it hears neither the carrier nor a message",
    "of a bound buoy. At the count `maxSilentWindows` the **carrier** is lost, as",
    "[4.2.6](030-4.2.6-link-resumption.md#4.2.6) says.",
    "",
    "| Field | Meaning |",
    "|---|---|",
    "| silent | The count of windows without carrier |",
  );

  it("finds a quotation word for word, whatever the line breaks, the emphasis and the links", () => {
    expect(quotationStandsIn("At the count maxSilentWindows the carrier is lost", source)).toBe(
      true,
    );
    expect(
      quotationStandsIn("it hears neither the carrier\nnor a message of a bound buoy.", source),
    ).toBe(true);
    expect(quotationStandsIn("the **carrier** is lost, as [4.2.6](other.md) says.", source)).toBe(
      true,
    );
    expect(quotationStandsIn("silent The count of windows without carrier", source)).toBe(true);
    expect(quotationStandsIn("", source)).toBe(true);
  });

  it("takes an elision for words left out, in the order of the source", () => {
    expect(
      quotationStandsIn("A shore station counts the windows … the carrier is lost", source),
    ).toBe(true);
    expect(quotationStandsIn("A shore station counts ... is lost, as 4.2.6 says.", source)).toBe(
      true,
    );
    // The parts in another order than the source has them.
    expect(
      quotationStandsIn("the carrier is lost … A shore station counts the windows", source),
    ).toBe(false);
  });

  it("refuses a word changed, words in another order, and a text from elsewhere", () => {
    expect(quotationStandsIn("At the count maxSilentWindows the carrier is found", source)).toBe(
      false,
    );
    expect(quotationStandsIn("the carrier nor a message hears neither", source)).toBe(false);
    expect(quotationStandsIn("A buoy that misses its window waits for the next.", source)).toBe(
      false,
    );
    expect(quotationStandsIn("at the count maxsilentwindows", source)).toBe(false);
  });
});

describe("foldQuoted", () => {
  it("folds links to their words and takes the marks out, in time that grows with the text", () => {
    expect(foldQuoted("See [the *guide*](docs/guide.md#top) and `code` \\| more.")).toBe(
      "See the guide and code more.",
    );
    // A destination never closed on its line is text; brackets alone are marks.
    expect(foldQuoted("[open](never closed\nnext line) [sic]")).toBe(
      "open(never closed next line) sic",
    );
    const length = 200_000;
    expect(foldQuoted("](".repeat(length))).toBe("(".repeat(length));
    expect(foldQuoted("[".repeat(length))).toBe("");
    expect(foldQuoted(`${"](".repeat(length)})`).length).toBeLessThan(length * 2);
  }, 60_000);
});
