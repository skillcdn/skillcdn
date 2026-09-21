import { lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import styles from "./app.module.css";
import { Layout } from "./components/layout.js";
import { Container, Skeleton } from "./components/ui.js";
import { I18nContext, messagesFor } from "./i18n/index.js";
import { languageOfSearch } from "./i18n/languages.js";
import { type AppLocation, LocationProvider, useLocation } from "./navigation.js";
import { ExplorePage } from "./pages/explore.js";
import { LandingPage } from "./pages/landing.js";
import { BadAddressPage, NotFoundPage } from "./pages/simple.js";
import { matchRoute, type Route } from "./router.js";
import { applyHead, buildHead } from "./seo/head.js";

// The explorer view brings the Markdown renderer with it. The front pages do not need it, and
// the view is never prerendered, so it loads when someone opens an address.
const MountPage = lazy(() =>
  import("./pages/mount.js").then((module) => ({ default: module.MountPage })),
);

// Only a development build knows this page; in production the import is never reached, so the
// bundler leaves the page and its fixtures out.
const StatesPage = import.meta.env.DEV
  ? lazy(() => import("./pages/states.js").then((module) => ({ default: module.StatesPage })))
  : undefined;
const OgCard = import.meta.env.DEV
  ? lazy(() => import("./pages/og-card.js").then((module) => ({ default: module.OgCard })))
  : undefined;

export interface AppProps {
  readonly initialLocation: AppLocation;
  /** The public origin, for URLs a visitor copies and for canonical links. */
  readonly origin: string;
  /**
   * Render only the frame, with a placeholder where the page goes. The prerendered shell for
   * routes that depend on data is made this way.
   */
  readonly shell?: boolean;
}

function pageOf(route: Route, origin: string): ReactNode {
  switch (route.name) {
    case "landing":
      return <LandingPage origin={origin} />;
    case "explore":
      return <ExplorePage origin={origin} />;
    case "mount":
      return <MountPage origin={origin} address={route.address} view={route.view} />;
    case "bad-address":
      return <BadAddressPage origin={origin} error={route.error} />;
    case "states":
      return StatesPage === undefined ? <NotFoundPage /> : <StatesPage origin={origin} />;
    case "og-card":
      return <NotFoundPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}

function Routed(props: { readonly origin: string; readonly shell: boolean }) {
  const location = useLocation();
  const language = languageOfSearch(location.search);
  const i18n = useMemo(() => ({ language, t: messagesFor(language) }), [language]);
  const route = matchRoute(location.pathname, location.search, import.meta.env.DEV);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the route is a function of the location
  useEffect(() => {
    applyHead(buildHead(route, language, props.origin));
  }, [location.pathname, location.search, language, props.origin]);

  const placeholder = (
    <Container>
      <div className={styles.placeholder}>
        <Skeleton lines={6} label={i18n.t.common.loading} />
      </div>
    </Container>
  );

  // A picture, not a page: it is rendered without the frame around it.
  if (route.name === "og-card" && OgCard !== undefined) {
    return (
      <I18nContext.Provider value={i18n}>
        <Suspense fallback={null}>
          <OgCard />
        </Suspense>
      </I18nContext.Provider>
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
      <Layout>
        {props.shell ? (
          placeholder
        ) : (
          <Suspense fallback={placeholder}>{pageOf(route, props.origin)}</Suspense>
        )}
      </Layout>
    </I18nContext.Provider>
  );
}

export function App(props: AppProps) {
  return (
    <LocationProvider initial={props.initialLocation}>
      <Routed origin={props.origin} shell={props.shell === true} />
    </LocationProvider>
  );
}
