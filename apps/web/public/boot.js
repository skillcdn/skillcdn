// Runs before the first paint, so the language does not flash.
// A plain script on purpose: it must work before any bundle has loaded. The language list is
// checked against src/i18n/languages.ts by a test.
(() => {
  const SUPPORTED = ["en", "ko"];
  const DEFAULT = "en";

  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const url = new URL(location.href);
  if (url.searchParams.has("lang")) {
    return;
  }
  // A URL without a language is the default language, unless the visitor chose another one or,
  // never having chosen, reads another supported language first.
  let wanted = stored("skillcdn.lang");
  if (!SUPPORTED.includes(wanted)) {
    const preferred = navigator.languages ?? [navigator.language];
    wanted =
      preferred
        .map((tag) => String(tag).toLowerCase().split("-")[0])
        .find((code) => SUPPORTED.includes(code)) ?? DEFAULT;
  }
  if (wanted !== DEFAULT) {
    url.searchParams.set("lang", wanted);
    location.replace(url.href);
  }
})();
