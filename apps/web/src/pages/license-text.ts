import type { RestLicense } from "@skillcdn/core";

/** The words for a license fact, in the visitor's language. */
export interface LicenseWords {
  readonly licenseNone: string;
  readonly licenseUnrecognized: string;
  readonly licenseSource: (source: string) => string;
}

/** `MIT (from LICENSE)`, `Unrecognized license (from skills/x/LICENSE)`, `None declared`. */
export function licenseLabel(words: LicenseWords, license: RestLicense): string {
  if (license.kind === "none") return words.licenseNone;
  const name = license.name ?? words.licenseUnrecognized;
  return license.source === null ? name : `${name} (${words.licenseSource(license.source)})`;
}
