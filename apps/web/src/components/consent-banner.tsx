import { useEffect, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { readLegalLinks } from "../site.js";
import styles from "./consent-banner.module.css";
import { Button } from "./ui.js";

/**
 * What the server's analytics bootstrap leaves on the page when analytics are configured
 * (`deploy/README.md`): whether the visitor is to be asked, and where the answer goes. Without
 * analytics there is nothing here, and the banner never shows.
 */
interface AnalyticsConsent {
  readonly ask: boolean;
  decide(granted: boolean): void;
}

declare global {
  interface Window {
    skillcdnAnalytics?: AnalyticsConsent;
  }
}

/** Asks once whether analytics may run. Prerendered pages carry no banner; it appears after mount. */
export function ConsentBanner() {
  const { t } = useI18n();
  const [consent, setConsent] = useState<AnalyticsConsent | undefined>(undefined);
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
      <p className={styles.text}>
        {t.consent.text}
        {privacyUrl !== undefined && (
          <>
            {" "}
            <a href={privacyUrl}>{t.consent.privacy}</a>
          </>
        )}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={() => decide(true)}>
          {t.consent.accept}
        </Button>
        <Button size="sm" onClick={() => decide(false)}>
          {t.consent.decline}
        </Button>
      </div>
    </section>
  );
}
