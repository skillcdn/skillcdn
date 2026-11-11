import { describe, expect, it } from "vitest";
import { fragmentResolver, headingSlug, sectionOfFragment } from "./fragments.js";

const DOCUMENT = [
  "---",
  "title: 4.2 Link procedures",
  "---",
  "# 4 Link control",
  "",
  "## 4.2 Link procedures",
  "",
  "Every procedure begins with one message.",
  "",
  "### 4.2.6 Link resumption",
  "",
  "A lost link is taken up again.",
  "",
  "#### 4.2.6.1 Initiation",
  "",
  "The buoy asks.",
  "",
  "#### 4.2.6.2 Guard times",
  "",
  '<a id="guard-table"></a>',
  "",
  "The buoy waits.",
  "",
  "### 4.2.7 Detection of carrier loss",
  "",
  "A station counts the windows.",
  "",
  "## TABLE C-2: Modifier codes: AA to BZ",
  "",
  "| Code |",
  "|---|",
  "",
].join("\n");

const read = (fragment: string): string | undefined => {
  const section = sectionOfFragment(DOCUMENT, fragment);
  return section === undefined
    ? undefined
    : DOCUMENT.slice(section.offset, section.offset + section.length);
};

describe("headingSlug", () => {
  it.each([
    ["4.2.7 Detection of carrier loss", "4.2.7-detection-of-carrier-loss"],
    ["TABLE C-2: Modifier codes: AA to BZ", "table-c-2-modifier-codes-aa-to-bz"],
    ["Table 4. Limits (informative)", "table-4-limits-informative"],
    ["  What's new?  ", "whats-new"],
    ["", ""],
    ["***", ""],
  ])("writes %j as %j", (heading, slug) => {
    expect(headingSlug(heading)).toBe(slug);
  });
});

describe("sectionOfFragment", () => {
  it("names a section by the number its heading begins with, with the sections under it", () => {
    const section = read("4.2.6");
    expect(section?.startsWith("### 4.2.6 Link resumption")).toBe(true);
    // The two clauses under it come with it; the next clause of its own level does not.
    expect(section).toContain("#### 4.2.6.1 Initiation");
    expect(section).toContain("#### 4.2.6.2 Guard times");
    expect(section).not.toContain("4.2.7");
    // A clause without clauses under it is itself.
    expect(read("4.2.6.1")).toBe("#### 4.2.6.1 Initiation\n\nThe buoy asks.\n\n");
    expect(read("4.2.7")?.startsWith("### 4.2.7 Detection")).toBe(true);
    expect(read("4.2")?.startsWith("## 4.2 Link procedures")).toBe(true);
    expect(read("4.2")).toContain("### 4.2.7 Detection of carrier loss");
    expect(read("4.2")).not.toContain("TABLE C-2");
  });

  it("names a section by its slug, whole or by the words it begins with, whatever the case", () => {
    for (const fragment of [
      "table-c-2",
      "TABLE-C-2",
      "table-c-2-modifier-codes",
      "table-c-2-modifier-codes-aa-to-bz",
      "4.2.7-detection-of-carrier-loss",
      // As the renderer of a git host writes it, without the dots.
      "427-detection-of-carrier-loss",
      "4.2.7%20detection".replace("%20", "-"),
    ]) {
      expect(read(fragment), fragment).toBeDefined();
    }
    expect(read("table-c-2")?.startsWith("## TABLE C-2")).toBe(true);
  });

  it("names nothing by part of a word or of a number", () => {
    for (const fragment of ["4.2.6.", "4.2.60", "4.2.6.1-init", "table-c", "table-c-20", ""]) {
      expect(read(fragment), JSON.stringify(fragment)).toBeUndefined();
    }
    // `4.2.6` is not `4.2.6.1`, though the one begins with the other.
    expect(read("4.2.6")?.startsWith("### 4.2.6 ")).toBe(true);
  });

  it("names the section an explicit anchor stands in, when no heading has the name", () => {
    expect(read("guard-table")?.startsWith("#### 4.2.6.2 Guard times")).toBe(true);
    expect(read("no-such-anchor")).toBeUndefined();
    // Before the first heading: the text up to it.
    const early = '<a name="top"></a>\n\nIntroduction.\n\n# Title\n';
    expect(sectionOfFragment(early, "top")).toEqual({
      offset: 0,
      length: early.indexOf("# Title"),
    });
  });

  it("takes the first heading a fragment names, and reads the headings once for many fragments", () => {
    const twice = "## Notes\n\nFirst.\n\n## Notes\n\nSecond.\n";
    expect(sectionOfFragment(twice, "notes")).toEqual({ offset: 0, length: 18 });
    const resolve = fragmentResolver(DOCUMENT);
    expect(resolve("4.2.6")).toEqual(sectionOfFragment(DOCUMENT, "4.2.6"));
    expect(resolve("4.2.7")).toEqual(sectionOfFragment(DOCUMENT, "4.2.7"));
  });

  it("answers nothing for a document without headings, and for a fragment no document could have", () => {
    expect(sectionOfFragment("Prose only.", "intro")).toBeUndefined();
    expect(sectionOfFragment("", "intro")).toBeUndefined();
    expect(sectionOfFragment(DOCUMENT, "x".repeat(10_000))).toBeUndefined();
    expect(sectionOfFragment(DOCUMENT, "%E0%A4%A")).toBeUndefined();
  });

  it("stays linear in a document of many anchors and many fragments", () => {
    const anchors = Array.from({ length: 20_000 }, (_, at) => `<a id="a${at}"></a>`).join("\n");
    const text = `# Title\n\n${anchors}\n`;
    const resolve = fragmentResolver(text);
    for (let at = 0; at < 20_000; at += 1) {
      resolve(`missing-${at}`);
    }
    expect(resolve("a10")).toEqual({ offset: 0, length: text.length });
  }, 60_000);
});
