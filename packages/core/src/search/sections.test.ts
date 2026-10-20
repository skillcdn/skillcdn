import { describe, expect, it } from "vitest";
import { queryLexemes } from "./lexemes.js";
import { MAX_EXCERPT_LENGTH, matchSections } from "./sections.js";

const DOCUMENT = [
  "---",
  "title: Billing",
  "---",
  "# Billing",
  "",
  "How a workspace is charged.",
  "",
  "## Plans",
  "",
  "A workspace is on one plan at a time.",
  "",
  "## Discounts",
  "",
  "Volume discounts apply from ten seats. An annual commitment takes a further tenth off.",
  "",
  "### Education",
  "",
  "Schools pay half.",
  "",
  "## Invoices",
  "",
  "```",
  "discount: none",
  "```",
  "",
  "An invoice is sent on the first of the month.",
  "",
].join("\n");

describe("matchSections", () => {
  it("names the sections that match, best first, with the heading path and what reads them", () => {
    const sections = matchSections(DOCUMENT, queryLexemes("volume discount"));
    expect(sections[0]).toEqual({
      heading: ["Billing", "Discounts"],
      offset: DOCUMENT.indexOf("## Discounts"),
      length: DOCUMENT.indexOf("### Education") - DOCUMENT.indexOf("## Discounts"),
      excerpt:
        "Volume discounts apply from ten seats. An annual commitment takes a further tenth off.",
    });
    expect(sections).toHaveLength(2);
    // The child matched the words of its parent's heading only, so it comes after the parent.
    expect(sections[1]?.heading).toEqual(["Billing", "Discounts", "Education"]);
  });

  it("takes the excerpt from the line that matched, not from code, and falls back to the first prose", () => {
    const invoices = matchSections(DOCUMENT, queryLexemes("invoice"))[0];
    expect(invoices?.heading).toEqual(["Billing", "Invoices"]);
    expect(invoices?.excerpt).toBe("An invoice is sent on the first of the month.");
    // The heading matched, no line did: the first prose line stands in.
    const education = matchSections(DOCUMENT, queryLexemes("education"))[0];
    expect(education?.heading).toEqual(["Billing", "Discounts", "Education"]);
    expect(education?.excerpt).toBe("Schools pay half.");
  });

  it("treats the text before the first heading, and a document without headings, as sections", () => {
    const plain = "Just a note about invoices.\n";
    expect(matchSections(plain, queryLexemes("invoices"))).toEqual([
      { heading: [], offset: 0, length: plain.length, excerpt: "Just a note about invoices." },
    ]);
    const preamble = "Intro mentions invoices.\n\n# Title\n\nBody.\n";
    const [first] = matchSections(preamble, queryLexemes("invoices"));
    expect(first).toMatchObject({ heading: [], offset: 0, excerpt: "Intro mentions invoices." });
  });

  it("answers nothing for no lexemes and for words the text lacks", () => {
    expect(matchSections(DOCUMENT, [])).toEqual([]);
    expect(matchSections(DOCUMENT, queryLexemes("zeppelin"))).toEqual([]);
  });

  it("cuts a long line to a window around the match", () => {
    const filler = "word ".repeat(120);
    const text = `# T\n\n${filler}the needle is here ${filler}\n`;
    const [section] = matchSections(text, queryLexemes("needle"));
    expect(section?.excerpt).toContain("needle");
    expect(section?.excerpt?.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH + 2);
    expect(section?.excerpt?.startsWith("…")).toBe(true);
  });

  it("prefers the prose that holds the most of the words asked for", () => {
    const text = [
      "# Fees",
      "",
      "A fee is charged monthly.",
      "",
      "A bookkeeper can waive a fee from the invoice.",
      "",
    ].join("\n");
    const [section] = matchSections(text, queryLexemes("waive a fee"));
    expect(section?.excerpt).toBe("A bookkeeper can waive a fee from the invoice.");
  });

  it("reads a setext heading's two lines as the heading, not as the excerpt", () => {
    const text = "Title\n=====\n\nThe body mentions invoices.\n";
    const [section] = matchSections(text, queryLexemes("invoices"));
    expect(section?.heading).toEqual(["Title"]);
    expect(section?.excerpt).toBe("The body mentions invoices.");
  });
});
