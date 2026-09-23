import { useEffect, useRef } from "react";
import { useI18n, useLanguagePreference } from "../i18n/index.js";
import { DEFAULT_LANGUAGE, LANGUAGE_INFO, LANGUAGES, withLanguage } from "../i18n/languages.js";
import { rememberLanguage } from "../i18n/preference.js";
import { Link, navigate, useLocation } from "../navigation.js";
import styles from "./language-switcher.module.css";

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
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !disclosure.current?.contains(event.target) &&
        disclosure.current
      )
        disclosure.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <nav aria-label={t.language.label}>
      <details
        ref={disclosure}
        className={styles.picker}
        onKeyDown={(event) => {
          if (event.key === "Escape" && disclosure.current?.open) {
            disclosure.current.open = false;
            disclosure.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label={`${t.language.label}: ${LANGUAGE_INFO[language].label}`}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3 12h18" />
          </svg>
          {LANGUAGE_INFO[language].label}
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </summary>
        <ul className={styles.list}>
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
                className={code === language ? styles.active : undefined}
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
                  if (disclosure.current) {
                    disclosure.current.open = false;
                    disclosure.current.querySelector("summary")?.focus();
                  }
                  navigate(withLanguage(here, DEFAULT_LANGUAGE), { replace: true });
                }}
              >
                {LANGUAGE_INFO[code].label}
                <span aria-hidden="true">{code === language ? "✓" : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
