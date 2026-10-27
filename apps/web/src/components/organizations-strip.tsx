import type { RestShowcaseOrganization } from "@skillcdn/core";
import { track } from "../analytics.js";
import { useI18n } from "../i18n/index.js";
import { LINKS } from "../site.js";
import styles from "./organizations-strip.module.css";
import { ArrowIcon } from "./ui.js";

/**
 * The organizations working with the deployment (ADR-0028), their marks in a strip under the
 * first screen, with the way to join beside the label; both leave the site, in a tab of their
 * own. On a phone the strip rolls, the marks
 * twice over so that the roll never shows its end; the second set is for the eye alone.
 */
export function OrganizationsStrip(props: {
  readonly organizations: readonly RestShowcaseOrganization[];
}) {
  const { t } = useI18n();
  const copy = t.landing.organizations;
  // The second set is for the roll alone: pictures, not links, and nothing to read.
  const marks = (hidden: boolean) => (
    <>
      {props.organizations.map((organization) =>
        hidden ? (
          <span key={`${organization.id} again`} className={styles.mark} aria-hidden="true">
            <img src={organization.logo.url} alt="" />
          </span>
        ) : (
          <a
            key={organization.id}
            className={styles.mark}
            href={organization.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={organization.logo.url} alt={organization.name} />
          </a>
        ),
      )}
      <span className={styles.more} aria-hidden={hidden ? "true" : undefined}>
        {copy.more}
      </span>
    </>
  );
  return (
    <section className={styles.strip} aria-label={copy.title}>
      <div className={styles.head}>
        <span className={styles.label}>{copy.title}</span>
        <a
          className={styles.join}
          href={LINKS.builders}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("cta_click", { id: "organizations_join" })}
        >
          {copy.join}
          <ArrowIcon />
        </a>
      </div>
      <div className={styles.rail}>
        <div className={styles.track}>
          {marks(false)}
          {marks(true)}
        </div>
      </div>
    </section>
  );
}
