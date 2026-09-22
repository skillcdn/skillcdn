import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type InitialData, InitialDataContext } from "./api/initial-data.js";
import styles from "./app.module.css";
import { Layout } from "./components/layout.js";
import { Container, Skeleton } from "./components/ui.js";
import { I18nContext, LanguagePreferenceContext, messagesFor } from "./i18n/index.js";
import { LANGUAGE_PENDING_ATTRIBUTE, type Language, resolveLanguage } from "./i18n/languages.js";
import { type AppLocation, LocationProvider, useLocation } from "./navigation.js";
import { ExplorePage } from "./pages/explore.js";
import { LandingPage } from "./pages/landing.js";
import type { MountPageProps } from "./pages/mount.js";
import { BadAddressPage, NotFoundPage } from "./pages/simple.js";
import { matchRoute, type Route } from "./router.js";
import { applyHead, buildHead } from "./seo/head.js";

// The explorer view brings the Markdown renderer with it. The front pages do not need it, so in
// the browser it loads when someone opens an address. The server, which renders that view with
// its data, passes the component in instead (entry-server.tsx).
const LazyMountPage = lazy(() =>
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
  /** Answers the page was rendered with on the server, by resource key. */
  readonly initialData?: InitialData;
  /** The explorer view, when it must render at once rather than load. */
  readonly mountPage?: ComponentType<MountPageProps>;
  /**
   * The language a URL without one is shown in: the visitor's choice or their browser's, read
   * by the browser entry. The server, which has no visitor, leaves it out and renders the default.
   */
  readonly preferredLanguage?: Language;
}

function pageOf(route: Route, origin: string, MountPage: ComponentType<MountPageProps>): ReactNode {
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

function Routed(props: {
  readonly origin: string;
  readonly shell: boolean;
  readonly mountPage: ComponentType<MountPageProps>;
  readonly preferredLanguage: Language | undefined;
}) {
  const location = useLocation();
  const { language, forced } = resolveLanguage(location.search, props.preferredLanguage);
  const i18n = useMemo(() => ({ language, forced, t: messagesFor(language) }), [language, forced]);
  const route = matchRoute(location.pathname, location.search, import.meta.env.DEV);

  // The view of an address writes its own head once it knows what it shows (pages/mount.tsx).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route is a function of the location
  useEffect(() => {
    if (route.name !== "mount") {
      applyHead(buildHead(route, language, props.origin));
    }
  }, [location.pathname, location.search, language, props.origin]);

  // A page prerendered in the default language is hidden by public/boot.js until it is rendered
  // in the visitor's language, which has now happened.
  useEffect(() => {
    document.documentElement.removeAttribute(LANGUAGE_PENDING_ATTRIBUTE);
  }, []);

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
          <Suspense fallback={placeholder}>{pageOf(route, props.origin, props.mountPage)}</Suspense>
        )}
      </Layout>
    </I18nContext.Provider>
  );
}

export function App(props: AppProps) {
  const [preferred, setPreferred] = useState(props.preferredLanguage);
  const preference = useMemo(() => ({ preferred, setPreferred }), [preferred]);
  return (
    <InitialDataContext.Provider value={props.initialData ?? {}}>
      <LanguagePreferenceContext.Provider value={preference}>
        <LocationProvider initial={props.initialLocation}>
          <Routed
            origin={props.origin}
            shell={props.shell === true}
            mountPage={props.mountPage ?? LazyMountPage}
            preferredLanguage={preferred}
          />
        </LocationProvider>
      </LanguagePreferenceContext.Provider>
    </InitialDataContext.Provider>
  );
}
