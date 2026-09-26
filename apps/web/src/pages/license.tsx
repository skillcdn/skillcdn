import { isLicenseFileName, type RestLicense, type RestMount } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { hostFileUrl } from "./host-links.js";

/** The words for a license fact, in the visitor's language. */
export interface LicenseWords {
  readonly licenseNone: string;
  readonly licenseUnrecognized: string;
}

/** `MIT`, `Unrecognized license`, `None declared`. */
export function licenseLabel(words: LicenseWords, license: RestLicense): string {
  if (license.kind === "none") return words.licenseNone;
  return license.name ?? words.licenseUnrecognized;
}

/**
 * A license as a fact: its name, and a way to the license file at the host when that is where
 * the index found it. A license declared in a manifest's front matter is named alone.
 */
export function LicenseValue(props: { readonly license: RestLicense; readonly mount: RestMount }) {
  const { t } = useI18n();
  const label = licenseLabel(t.skill, props.license);
  const source = props.license.source;
  const file =
    source !== null && isLicenseFileName(source.split("/").at(-1) ?? "")
      ? hostFileUrl(props.mount, source)
      : undefined;
  return file === undefined ? (
    label
  ) : (
    <a href={file} target="_blank" rel="noopener noreferrer" title={t.skill.licenseFile}>
      {label}
    </a>
  );
}
