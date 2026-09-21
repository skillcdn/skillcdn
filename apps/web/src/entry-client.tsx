import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./app.js";
import { LANGUAGE_INFO, languageOfSearch } from "./i18n/languages.js";
import { matchRoute } from "./router.js";
import { ORIGIN_META_NAME, ORIGIN_PLACEHOLDER, readOrigin } from "./site.js";
// biome-ignore lint/correctness/useImportExtensions: a style sheet keeps its extension
import "./styles/tokens.css";
// biome-ignore lint/correctness/useImportExtensions: a style sheet keeps its extension
import "./styles/base.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the page has no #root element");
}

const location = { pathname: window.location.pathname, search: window.location.search };
const route = matchRoute(location.pathname, location.search, import.meta.env.DEV);
const language = languageOfSearch(location.search);
const app = (
  <StrictMode>
    <App initialLocation={location} origin={readOrigin()} />
  </StrictMode>
);

// Hydrate only what was prerendered as exactly this page: the same route, the same language, and
// the origin filled in. A shell, a page from a host that ignores the language, or a page whose
// placeholders were never replaced is rendered afresh instead.
const declaredOrigin = document
  .querySelector(`meta[name="${ORIGIN_META_NAME}"]`)
  ?.getAttribute("content");
const prerenderedAsThis =
  container.dataset.prerendered === route.name &&
  document.documentElement.lang === LANGUAGE_INFO[language].htmlLang &&
  declaredOrigin !== ORIGIN_PLACEHOLDER;

if (prerenderedAsThis) {
  hydrateRoot(container, app);
} else {
  container.replaceChildren();
  createRoot(container).render(app);
}
