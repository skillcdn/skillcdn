import { useI18n } from "../i18n/index.js";
import {
  LANGUAGE_INFO,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  type Language,
  withLanguage,
} from "../i18n/languages.js";
import { Link, useLocation } from "../navigation.js";
import styles from "./controls.module.css";

function remember(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Without storage the URL still carries the choice.
  }
}

/**
 * One real link per language, to the same page. Crawlers follow them like any link; for a
 * visitor the choice is also remembered, so later visits without a language in the URL keep it.
 */
export function LanguageSwitcher() {
  const { language, t } = useI18n();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  return (
    <nav aria-label={t.language.label}>
      <ul className={styles.languages}>
        {LANGUAGES.map((code) => (
          <li key={code}>
            <Link
              exact
              href={withLanguage(here, code)}
              hrefLang={LANGUAGE_INFO[code].htmlLang}
              lang={LANGUAGE_INFO[code].htmlLang}
              aria-current={code === language ? "true" : undefined}
              className={code === language ? styles.activeLanguage : styles.language}
              onClick={() => remember(code)}
            >
              {LANGUAGE_INFO[code].label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
