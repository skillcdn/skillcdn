import { useEffect, useState } from "react";
import type { AnalyticsState } from "../analytics.js";
import { useI18n } from "../i18n/index.js";
import { readLegalLinks } from "../site.js";
import { BrandSymbol } from "./brand.js";
import styles from "./consent-banner.module.css";
import { Button } from "./ui.js";

/**
 * Asks once whether analytics may run (`src/analytics.ts`): a card in the glass of the site at
 * the foot of the page, which goes away with the answer. Prerendered pages carry no banner; it
 * appears after mount, and only when the bootstrap says the visitor is to be asked.
 */
export function ConsentBanner() {
  const { t } = useI18n();
  const [consent, setConsent] = useState<AnalyticsState | undefined>(undefined);
  const [privacyUrl, setPrivacyUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    const found = window.skillcdnAnalytics;
    if (found?.ask === true) {
      setConsent(found);
      setPrivacyUrl(readLegalLinks().privacyUrl);
    }
  }, []);
  if (consent === undefined) {
    return null;
  }
  const decide = (granted: boolean): void => {
    consent.decide(granted);
    setConsent(undefined);
  };
  return (
    <section className={styles.banner} aria-label={t.consent.label}>
      <span className={styles.badge} aria-hidden="true">
        <BrandSymbol className={styles.symbol} />
      </span>
      <div className={styles.words}>
        <p className={styles.title}>{t.consent.title}</p>
        <p className={styles.text}>
          {t.consent.text}
          {privacyUrl !== undefined && (
            <>
              {" "}
              {/* Beside the page, so that reading it does not lose the question. */}
              <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
                {t.consent.privacy}
              </a>
            </>
          )}
        </p>
      </div>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={() => decide(true)}>
          {t.consent.accept}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => decide(false)}>
          {t.consent.decline}
        </Button>
      </div>
    </section>
  );
}
