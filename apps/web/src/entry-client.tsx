import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { readInitialData } from "./api/initial-data.js";
import { App } from "./app.js";
import {
  LANGUAGE_INFO,
  LANGUAGE_STORAGE_KEY,
  preferredLanguage,
  resolveLanguage,
} from "./i18n/languages.js";
import { matchRoute } from "./router.js";
import { ORIGIN_META_NAME, ORIGIN_PLACEHOLDER, readOrigin } from "./site.js";
// Pretendard is served from this origin: the content security policy allows no other source,
// and the image has to work without the internet.
// biome-ignore lint/correctness/useImportExtensions: a style sheet keeps its extension
import "./styles/pretendard.css";
// biome-ignore lint/correctness/useImportExtensions: a style sheet keeps its extension
import "./styles/tokens.css";
// biome-ignore lint/correctness/useImportExtensions: a style sheet keeps its extension
import "./styles/base.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the page has no #root element");
}

function storedLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

const location = { pathname: window.location.pathname, search: window.location.search };
const route = matchRoute(location.pathname, location.search, import.meta.env.DEV);
// The same rule public/boot.js applied before the first paint: a URL without a language shows
// the visitor's choice, else their browser's, without the URL changing.
const preferred = preferredLanguage(storedLanguage(), navigator.languages ?? [navigator.language]);
const { language } = resolveLanguage(location.search, preferred);
const initialData = readInitialData();
const app = (
  <StrictMode>
    <App
      initialLocation={location}
      origin={readOrigin()}
      initialData={initialData}
      preferredLanguage={preferred}
    />
  </StrictMode>
);

// Hydrate only what was prerendered as exactly this page: the same route, the same language, the
// origin filled in, and for the view of an address the answers it was rendered with. A shell, a
// page from a host that ignores the language, a page prerendered in the default language for a
// visitor who reads another, or a page whose placeholders were never replaced is rendered afresh
// instead (with the answers it carries, when it carries any).
const declaredOrigin = document
  .querySelector(`meta[name="${ORIGIN_META_NAME}"]`)
  ?.getAttribute("content");
const prerenderedAsThis =
  container.dataset.prerendered === route.name &&
  document.documentElement.lang === LANGUAGE_INFO[language].htmlLang &&
  declaredOrigin !== ORIGIN_PLACEHOLDER &&
  (route.name !== "mount" || Object.keys(initialData).length > 0);

if (prerenderedAsThis) {
  hydrateRoot(container, app);
} else {
  container.replaceChildren();
  createRoot(container).render(app);
}
