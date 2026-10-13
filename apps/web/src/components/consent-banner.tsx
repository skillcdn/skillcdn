import { useEffect, useState } from "react";
import type { AnalyticsState } from "../analytics.js";
import { useI18n } from "../i18n/index.js";
import { readLegalLinks } from "../site.js";
import { BrandSymbol } from "./brand.js";
import styles from "./consent-banner.module.css";
import { Button } from "./ui.js";

export interface ConsentBannerProps {
  /** What the bootstrap left on the page; `undefined` until the page is up, or without analytics. */
  readonly analytics: AnalyticsState | undefined;
  /** The visitor asked, from the footer, to see their choice and change it. */
  readonly choices: boolean;
  readonly onClose: () => void;
}

/**
 * The visitor's say over analytics (`src/analytics.ts`), as a card in the glass of the site at
 * the foot of the page. Where the visitor's region asks first, the card asks once and goes away
 * with the answer; from the footer, the same card says whether analytics run and offers to turn
 * them off, or on again. Prerendered pages carry no card: it appears after mount, only when the
 * bootstrap says the visitor is to be asked, or when they ask for it.
 */
export function ConsentBanner(props: ConsentBannerProps) {
  const { t } = useI18n();
  const { analytics, choices } = props;
  const [answered, setAnswered] = useState(false);
  const [privacyUrl, setPrivacyUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setPrivacyUrl(readLegalLinks().privacyUrl);
  }, []);
  if (analytics === undefined) {
    return null;
  }
  const asking = analytics.ask && !answered && !choices;
  if (!asking && !choices) {
    return null;
  }
  const words = asking
    ? { title: t.consent.title, text: t.consent.text }
    : analytics.active
      ? { title: t.consent.onTitle, text: t.consent.onText }
      : { title: t.consent.offTitle, text: t.consent.offText };
  const decide = (granted: boolean): void => {
    analytics.decide(granted);
    setAnswered(true);
    props.onClose();
  };
  return (
    <section className={styles.banner} aria-label={t.consent.label}>
      <span className={styles.badge} aria-hidden="true">
        <BrandSymbol className={styles.symbol} />
      </span>
      <div className={styles.words}>
        <p className={styles.title}>{words.title}</p>
        <p className={styles.text}>
          {words.text}
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
        {asking ? (
          <>
            <Button variant="primary" size="sm" onClick={() => decide(true)}>
              {t.consent.accept}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => decide(false)}>
              {t.consent.decline}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={() => decide(!analytics.active)}>
              {analytics.active ? t.consent.turnOff : t.consent.turnOn}
            </Button>
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t.consent.close}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
