import { describe, expect, it } from "vitest";
import { headingNames, isHeadedBy, queryIdentifiers } from "./identifiers.js";

describe("queryIdentifiers", () => {
  it.each([
    ["4.2.6", "4.2.6"],
    ["TABLE C-2", "TABLE C-2"],
    ["Table 4", "Table 4"],
    ["Annex B", "Annex B"],
    ["ResumeGuardTimes", "ResumeGuardTimes"],
    ["maxRetryCount g21", "maxRetryCount g21"],
    ["REQ-NAV-0412", "REQ-NAV-0412"],
    ['"4.2.6"?', "4.2.6"],
    ["  section 4.2.6  ", "section 4.2.6"],
  ])("reads %j as identifiers alone", (query, leading) => {
    expect(queryIdentifiers(query)).toEqual({ only: true, leading });
  });

  it.each([
    ["4.2.6 Link resumption", "4.2.6"],
    ["TABLE C-2 modifier codes for a lamp", "TABLE C-2"],
    ["ResumeGuardTimes field descriptions", "ResumeGuardTimes"],
    ["Annex B thresholds", "Annex B"],
    // A sentence written in capitals is no query of identifiers, though it begins with some.
    ["HOW DO I RESET MY PASSWORD", "HOW DO"],
    ["RESET THE PASSWORD OF AN ACCOUNT NOW", "RESET THE PASSWORD OF"],
  ])("reads the identifiers %j begins with", (query, leading) => {
    expect(queryIdentifiers(query)).toEqual({ only: false, leading });
  });

  it.each([
    "how is a link resumed after the carrier is lost",
    "Release notes",
    "table of contents",
    "Table",
    "annex b",
    "A guide to resumption",
    "",
    "   ",
    "?!",
  ])("reads no identifier in %j", (query) => {
    expect(queryIdentifiers(query)).toEqual({ only: false, leading: undefined });
  });

  it("reads the scripts without case by their digits alone", () => {
    const hangul = String.fromCodePoint(0xbd80, 0xb85d);
    expect(queryIdentifiers(`${hangul} 3`)).toEqual({ only: false, leading: undefined });
    expect(queryIdentifiers(`3.2 ${hangul}`)).toEqual({ only: false, leading: "3.2" });
  });

  it("looks at a bounded number of tokens, whatever it is given", () => {
    const long = "x1 ".repeat(100_000);
    expect(queryIdentifiers(long)).toEqual({ only: false, leading: "x1 x1 x1 x1" });
    expect(queryIdentifiers("(".repeat(100_000))).toEqual({ only: false, leading: undefined });
  });
});

describe("headingNames", () => {
  it.each([
    ["4.2.6 Link resumption", "4.2.6"],
    ["(4.2.6) Link resumption", "4.2.6"],
    ["Changes to 4.2.6", "4.2.6"],
    ["TABLE C-2: Modifier codes: AA to BZ", "table c-2"],
    ["Table 4. Thresholds", "Table 4"],
    ["6.1.8 ResumeGuardTimes", "ResumeGuardTimes"],
    ["ResumeGuardTimes field descriptions", "resumeguardtimes"],
  ])("finds in %j the identifiers %j", (heading, leading) => {
    expect(headingNames(heading, leading)).toBe(true);
  });

  it.each([
    ["4.2.6.1 Initiation", "4.2.6"],
    ["4.2.60 Something else", "4.2.6"],
    ["TABLE C-20 Other codes", "TABLE C-2"],
    ["TABLE of C-2 codes", "TABLE C-2"],
    ["ResumeGuardTimesList", "ResumeGuardTimes"],
    ["", "4.2.6"],
    ["4.2.6", ""],
    ["4.2.6", "()"],
  ])("finds none in %j of %j", (heading, leading) => {
    expect(headingNames(heading, leading)).toBe(false);
  });
});

describe("isHeadedBy", () => {
  const document = [
    "---",
    "title: 4.2.6 in the front matter is no heading",
    "---",
    "# 4 Link control",
    "",
    "See 4.2.7 for the loss of the carrier.",
    "",
    "### 4.2.6 Link resumption",
    "",
    "```",
    "## 4.2.9 A heading inside code is none",
    "```",
  ].join("\n");

  it("looks at the headings of a document, and at nothing else of it", () => {
    expect(isHeadedBy(document, "4.2.6")).toBe(true);
    expect(isHeadedBy(document, "4.2.7")).toBe(false);
    expect(isHeadedBy(document, "4.2.9")).toBe(false);
    expect(isHeadedBy("", "4.2.6")).toBe(false);
  });
});
