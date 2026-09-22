import { useI18n, useLanguagePreference } from "../i18n/index.js";
import { DEFAULT_LANGUAGE, LANGUAGE_INFO, LANGUAGES, withLanguage } from "../i18n/languages.js";
import { rememberLanguage } from "../i18n/preference.js";
import { Link, navigate, useLocation } from "../navigation.js";
import styles from "./controls.module.css";

/**
 * One real link per language, to the same page. Crawlers follow them like any link, to the URL
 * that forces that language. A visitor's click instead becomes their preference, replacing
 * whatever set it before: the page is shown in that language at its plain URL, and later visits
 * without a language keep it.
 */
export function LanguageSwitcher() {
  const { language, t } = useI18n();
  const { setPreferred } = useLanguagePreference();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  return (
    <nav aria-label={t.language.label}>
      <ul className={styles.segmented}>
        {LANGUAGES.map((code) => (
          <li key={code}>
            <Link
              exact
              href={withLanguage(here, code)}
              hrefLang={LANGUAGE_INFO[code].htmlLang}
              lang={LANGUAGE_INFO[code].htmlLang}
              aria-label={LANGUAGE_INFO[code].label}
              title={LANGUAGE_INFO[code].label}
              aria-current={code === language ? "true" : undefined}
              className={code === language ? styles.activeSegment : styles.segment}
              onClick={(event) => {
                // A modified click opens the forcing URL as any link would.
                const plain =
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey;
                if (event.defaultPrevented || !plain) {
                  return;
                }
                event.preventDefault();
                rememberLanguage(code);
                setPreferred(code);
                navigate(withLanguage(here, DEFAULT_LANGUAGE), { replace: true });
              }}
            >
              {LANGUAGE_INFO[code].short}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
