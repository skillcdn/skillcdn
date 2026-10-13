import { describe, expect, it } from "vitest";
import {
  asksConsent,
  DEFAULT_CONSENT_REGIONS,
  normalizeCountry,
  parseConsentRegions,
} from "./consent-regions.js";

describe("the regions where analytics ask first", () => {
  it("are read as everywhere, nowhere, or a list of codes in any case", () => {
    expect(parseConsentRegions("*")).toBe("*");
    expect(parseConsentRegions(" none ")).toEqual([]);
    expect(parseConsentRegions("NONE")).toEqual([]);
    expect(parseConsentRegions("de, fr ,US-CA,,")).toEqual(["DE", "FR", "US-CA"]);
    for (const bad of ["", ",", "Germany", "DE FR", "D", "US-california", "de;fr"]) {
      expect(parseConsentRegions(bad), bad).toBeUndefined();
    }
  });

  it("default to the European Economic Area, the United Kingdom and Switzerland", () => {
    expect(DEFAULT_CONSENT_REGIONS).toHaveLength(32);
    expect(DEFAULT_CONSENT_REGIONS).toContain("DE");
    expect(DEFAULT_CONSENT_REGIONS).toContain("NO");
    expect(DEFAULT_CONSENT_REGIONS).toContain("GB");
    expect(DEFAULT_CONSENT_REGIONS).toContain("CH");
    expect(DEFAULT_CONSENT_REGIONS).not.toContain("US");
    expect(DEFAULT_CONSENT_REGIONS).not.toContain("KR");
  });

  it("ask a visitor in a listed region, in a subdivision of one, and one who could not be placed", () => {
    expect(asksConsent(DEFAULT_CONSENT_REGIONS, "DE")).toBe(true);
    expect(asksConsent(DEFAULT_CONSENT_REGIONS, "KR")).toBe(false);
    expect(asksConsent(DEFAULT_CONSENT_REGIONS, "US")).toBe(false);
    expect(asksConsent(DEFAULT_CONSENT_REGIONS, undefined)).toBe(true);
    expect(asksConsent(["US-CA"], "US")).toBe(false);
    expect(asksConsent(["US-CA"], "US-CA")).toBe(true);
    expect(asksConsent(["US"], "US-CA")).toBe(true);
    expect(asksConsent("*", "KR")).toBe(true);
    expect(asksConsent("*", undefined)).toBe(true);
    expect(asksConsent([], "DE")).toBe(false);
    expect(asksConsent([], undefined)).toBe(false);
  });

  it("take a region from a proxy as a code, and nothing that is not one", () => {
    expect(normalizeCountry(" kr ")).toBe("KR");
    expect(normalizeCountry("us-ca")).toBe("US-CA");
    for (const unplaced of ["XX", "ZZ", "T1", "", "   ", "Germany", "DE,FR", null, undefined]) {
      expect(normalizeCountry(unplaced), String(unplaced)).toBeUndefined();
    }
  });
});
