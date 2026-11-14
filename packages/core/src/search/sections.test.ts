import { describe, expect, it } from "vitest";
import { queryLexemes } from "./lexemes.js";
import {
  embeddedTextsOf,
  embeddingTextOf,
  HEAD_SECTION,
  headTextOf,
  MAX_EXCERPT_LENGTH,
  matchSections,
  SECTIONING_VERSION,
  sectionBody,
  sectionsOf,
} from "./sections.js";

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

describe("sectionsOf", () => {
  it("lists every section in document order, the heading path and what reads each", () => {
    const sections = sectionsOf(DOCUMENT);
    expect(sections.map((section) => section.heading)).toEqual([
      ["Billing"],
      ["Billing", "Plans"],
      ["Billing", "Discounts"],
      ["Billing", "Discounts", "Education"],
      ["Billing", "Invoices"],
    ]);
    // The sections tile the body: each ends where the next begins, the last at the end.
    expect(sections[0]?.offset).toBe(DOCUMENT.indexOf("# Billing"));
    sections.forEach((section, index) => {
      const next = sections[index + 1];
      expect(section.offset + section.length).toBe(next?.offset ?? DOCUMENT.length);
    });
    // Front-matter belongs to no section.
    expect(sections[0]?.offset).toBeGreaterThan(0);
  });

  it("makes a section of the text before the first heading when it holds anything, and of a document without headings", () => {
    expect(sectionsOf("Intro mentions invoices.\n\n# Title\n\nBody.\n")).toEqual([
      { heading: [], offset: 0, length: "Intro mentions invoices.\n\n".length },
      { heading: ["Title"], offset: 26, length: "# Title\n\nBody.\n".length },
    ]);
    expect(sectionsOf("\n\n# Title\nBody.\n")).toEqual([
      { heading: ["Title"], offset: 2, length: "# Title\nBody.\n".length },
    ]);
    const plain = "Just a note.\n";
    expect(sectionsOf(plain)).toEqual([{ heading: [], offset: 0, length: plain.length }]);
    expect(sectionsOf("")).toEqual([]);
    expect(sectionsOf("---\ntitle: Empty\n---\n")).toEqual([]);
  });

  it("is at its first version", () => {
    expect(SECTIONING_VERSION).toBe(1);
  });
});

describe("embeddingTextOf", () => {
  it("writes the title, the heading path and the body without the heading line", () => {
    const text = "# Billing\n\nHow it works.\n\n## Plans\n\nOne plan at a time.\nNo trials.\n";
    const [billing, plans] = sectionsOf(text);
    if (billing === undefined || plans === undefined) throw new Error("two sections");
    expect(sectionBody(text, plans)).toBe("\nOne plan at a time.\nNo trials.\n");
    expect(embeddingTextOf("Handbook", plans, text)).toBe(
      "Handbook > Billing > Plans: One plan at a time.\nNo trials.",
    );
    expect(embeddingTextOf(undefined, billing, text)).toBe("Billing: How it works.");
    // A document's title is usually its first heading: it is not said twice.
    expect(embeddingTextOf("Billing", plans, text)).toBe(
      "Billing > Plans: One plan at a time.\nNo trials.",
    );
    expect(embeddingTextOf(" billing ", billing, text)).toBe("Billing: How it works.");
  });

  it("gives the text before the first heading whole, and a heading alone when its body is blank", () => {
    const text = "Intro mentions invoices.\n\n# Title\n\n## Empty\n";
    const [preamble, title, empty] = sectionsOf(text);
    if (preamble === undefined || title === undefined || empty === undefined) {
      throw new Error("three sections");
    }
    expect(embeddingTextOf(undefined, preamble, text)).toBe("Intro mentions invoices.");
    expect(embeddingTextOf("Notes", preamble, text)).toBe("Notes: Intro mentions invoices.");
    expect(embeddingTextOf("Notes", title, text)).toBe("Notes > Title");
    expect(embeddingTextOf("  Notes  with   spaces ", empty, text)).toBe(
      "Notes with spaces > Title > Empty",
    );
  });

  it("reads a setext heading as the heading line", () => {
    const text = "Title\n=====\n\nThe body.\n";
    const [section] = sectionsOf(text);
    if (section === undefined) throw new Error("one section");
    expect(embeddingTextOf(undefined, section, text)).toBe("Title: The body.");
  });
});

describe("headTextOf", () => {
  it("writes a skill's name and description as one text", () => {
    expect(
      headTextOf({ kind: "skill", name: "deck-from-outline", description: "Drafts a slide deck." }),
    ).toBe("deck-from-outline: Drafts a slide deck.");
    expect(
      headTextOf({ kind: "skill", name: " deck ", description: "Drafts\n  a slide\tdeck. " }),
    ).toBe("deck: Drafts a slide deck.");
    expect(headTextOf({ kind: "skill", name: "deck", description: "  " })).toBe("deck");
    expect(headTextOf({ kind: "skill", name: "deck", description: null })).toBe("deck");
  });

  it("has none for a skill without a name, and for what is no skill", () => {
    expect(headTextOf({ kind: "skill", name: " ", description: "Drafts a deck." })).toBeUndefined();
    expect(headTextOf({ kind: "skill", description: "Drafts a deck." })).toBeUndefined();
    expect(
      headTextOf({ kind: "markdown", name: "deck", title: "Deck", description: "Drafts a deck." }),
    ).toBeUndefined();
  });
});

describe("embeddedTextsOf", () => {
  const SKILL = [
    "---",
    "name: deck-from-outline",
    "description: Drafts a slide deck.",
    "---",
    "# Deck from an outline",
    "",
    "Read the outline first.",
    "",
    "## Slides",
    "",
    "One idea a slide.",
    "",
  ].join("\n");

  it("gives a skill its head before its sections, under the number of the head", () => {
    const texts = embeddedTextsOf(
      { kind: "skill", name: "deck-from-outline", description: "Drafts a slide deck." },
      SKILL,
    );
    expect(texts.map((item) => [item.section, item.text])).toEqual([
      [HEAD_SECTION, "deck-from-outline: Drafts a slide deck."],
      [0, "deck-from-outline > Deck from an outline: Read the outline first."],
      [1, "deck-from-outline > Deck from an outline > Slides: One idea a slide."],
    ]);
    // The head names no passage of the body.
    expect(texts[0]).toMatchObject({ heading: [], offset: 0, length: 0 });
    expect(
      texts.slice(1).map(({ heading, offset, length }) => ({ heading, offset, length })),
    ).toEqual(sectionsOf(SKILL));
  });

  it("gives a document its sections under its title, and no head", () => {
    const texts = embeddedTextsOf(
      { kind: "markdown", title: "Handbook", description: "Drafts a slide deck." },
      SKILL,
    );
    expect(texts.map((item) => [item.section, item.text])).toEqual([
      [0, "Handbook > Deck from an outline: Read the outline first."],
      [1, "Handbook > Deck from an outline > Slides: One idea a slide."],
    ]);
  });

  it("gives a skill whose body is blank its head alone, and a blank document nothing", () => {
    const blank = "---\nname: deck\ndescription: Drafts a deck.\n---\n\n";
    expect(
      embeddedTextsOf({ kind: "skill", name: "deck", description: "Drafts a deck." }, blank).map(
        (item) => item.section,
      ),
    ).toEqual([HEAD_SECTION]);
    expect(embeddedTextsOf({ kind: "markdown", title: "Deck" }, blank)).toEqual([]);
  });
});

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

  it("weighs a word by its rarity among the sections of the document (ADR-0100)", () => {
    // A table of fields in sections of a few rows, as a long original is laid out: every
    // section holds the words every name is made of, and one section holds the name.
    const names = Array.from(
      { length: 60 },
      (_, at) => `BERTH_SLOT_${String(at).padStart(2, "0")}`,
    );
    const table = [
      "# Fields",
      "",
      ...Array.from({ length: 6 }, (_, section) => {
        const rows = names.slice(section * 10, section * 10 + 10);
        return [
          `## ${rows[0]} to ${rows[9]}`,
          "",
          "| Name | Kind | Unit |",
          "|---|---|---|",
          ...rows.map((name) => `| ${name} | BERTH SLOT enum | none |`),
          "",
        ].join("\n");
      }),
    ].join("\n");
    for (const [at, name] of names.entries()) {
      const [first] = matchSections(table, queryLexemes(name));
      const section = Math.floor(at / 10);
      // The section that holds the row, whichever section's heading names the words more often.
      expect(first?.heading).toEqual([
        "Fields",
        `${names[section * 10]} to ${names[section * 10 + 9]}`,
      ]);
    }
    // A part of the names alone still finds the table: every section holds it, the first first.
    expect(matchSections(table, queryLexemes("SLOT"))[0]?.heading).toEqual([
      "Fields",
      "BERTH_SLOT_00 to BERTH_SLOT_09",
    ]);
    // What the mount says of a word tells documents apart, not the sections of one: it is not read.
    const lexemes = queryLexemes("billing discounts");
    expect(matchSections(DOCUMENT, lexemes, { weights: [1, 0] })).toEqual(
      matchSections(DOCUMENT, lexemes, { weights: [0, 1] }),
    );
    expect(matchSections(DOCUMENT, lexemes)[0]?.heading).toEqual(["Billing", "Discounts"]);
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
