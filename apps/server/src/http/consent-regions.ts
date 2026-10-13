/**
 * Where analytics ask before they run (ADR-0051): the regions whose law wants a visitor's consent
 * before an analytics cookie is set. Everywhere else the pages run analytics and offer a way to
 * turn them off. A visitor whose region is not known is asked, since asking is the safe answer.
 */

/**
 * `*`: everywhere. Else regions as ISO 3166-1 alpha-2 codes (`DE`), or subdivisions as ISO 3166-2
 * (`US-CA`), which the analytics service's own regional defaults take in the same form; an empty
 * list asks nowhere.
 */
export type ConsentRegions = "*" | readonly string[];

/** The European Economic Area, the United Kingdom and Switzerland. */
export const DEFAULT_CONSENT_REGIONS: readonly string[] = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
];

const REGION = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;

/** The codes ISO 3166 leaves to users, which a proxy sends for a visitor it could not place. */
const UNASSIGNED = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ)$/;

/**
 * `*`, `none`, or a comma-separated list of regions, in any case and with spaces around them.
 * `undefined` for anything else, an empty list included.
 */
export function parseConsentRegions(text: string): ConsentRegions | undefined {
  const trimmed = text.trim();
  if (trimmed === "*") {
    return "*";
  }
  if (trimmed.toLowerCase() === "none") {
    return [];
  }
  const regions: string[] = [];
  for (const entry of trimmed.split(",")) {
    const code = entry.trim().toUpperCase();
    if (code === "") {
      continue;
    }
    if (!REGION.test(code)) {
      return undefined;
    }
    regions.push(code);
  }
  return regions.length === 0 ? undefined : regions;
}

/**
 * The region a trusted proxy names for the visitor, as a code; `undefined` for anything that is
 * not one, or that says the visitor could not be placed.
 */
export function normalizeCountry(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const code = value.trim().toUpperCase();
  return REGION.test(code) && !UNASSIGNED.test(code) ? code : undefined;
}

/** Whether a visitor from `country` (`undefined`: not known) is asked before analytics run. */
export function asksConsent(regions: ConsentRegions, country: string | undefined): boolean {
  if (regions === "*") {
    return true;
  }
  if (regions.length === 0) {
    return false;
  }
  if (country === undefined) {
    return true;
  }
  return regions.some((region) => country === region || country.startsWith(`${region}-`));
}
