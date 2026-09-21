import { useEffect, useState } from "react";
import { useI18n } from "../i18n/index.js";
import styles from "./controls.module.css";

type Theme = "system" | "light" | "dark";

const ORDER: readonly Theme[] = ["system", "light", "dark"];
/** Read by public/boot.js before the first paint. */
const STORAGE_KEY = "skillcdn.theme";

function readStored(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme): void {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  try {
    if (theme === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    // Without storage the choice lasts for this page only.
  }
}

const ICONS: Record<Theme, string> = {
  system: "M3 4.5h14v9H3zM7 17h6M10 13.5V17",
  light:
    "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
  dark: "M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z",
};

/** Cycles system, light, dark. The system theme is the default and needs no storage. */
export function ThemeToggle() {
  const { t } = useI18n();
  // The prerendered page cannot know the stored choice, so it starts as "system" on both sides.
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(readStored()), []);

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system";
  return (
    <button
      type="button"
      className={styles.iconButton}
      title={`${t.theme.label}: ${t.theme[theme]}`}
      aria-label={`${t.theme.label}: ${t.theme[theme]}`}
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path
          d={ICONS[theme]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
