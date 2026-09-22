// Runs before the first paint, so the language does not flash.
// A plain script on purpose: it must work before any bundle has loaded. The language list is
// checked against src/i18n/languages.ts by a test, and the rule here is the one in that file.
(() => {
  const SUPPORTED = ["en", "ko"];
  const DEFAULT = "en";
  const PENDING = "data-language-pending";

  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  // A URL that names a language is shown in that language, whatever the visitor prefers.
  if (new URL(location.href).searchParams.has("lang")) {
    return;
  }
  // A URL without one is shown in the language the visitor chose, or, never having chosen, in
  // the one their browser reads first. The URL stays as it is, so a shared link opens in each
  // reader's language. The page was prerendered in the default language: when another one is
  // wanted, the page stays hidden until the app has rendered it in that language, and shows
  // anyway after a moment should the app never arrive.
  let wanted = stored("skillcdn.lang");
  if (!SUPPORTED.includes(wanted)) {
    const preferred = navigator.languages ?? [navigator.language];
    wanted =
      preferred
        .map((tag) => String(tag).toLowerCase().split("-")[0])
        .find((code) => SUPPORTED.includes(code)) ?? DEFAULT;
  }
  if (wanted !== DEFAULT) {
    document.documentElement.lang = wanted;
    document.documentElement.setAttribute(PENDING, "");
    setTimeout(() => document.documentElement.removeAttribute(PENDING), 4000);
  }
})();
