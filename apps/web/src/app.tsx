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
import { SessionProvider } from "./auth/session.js";
import { Layout } from "./components/layout.js";
import { Container, Skeleton } from "./components/ui.js";
import { I18nContext, LanguagePreferenceContext, messagesFor } from "./i18n/index.js";
import { LANGUAGE_PENDING_ATTRIBUTE, type Language, resolveLanguage } from "./i18n/languages.js";
import { LegalLinksProvider } from "./legal-links.js";
import { type AppLocation, LocationProvider, useLocation } from "./navigation.js";
import type { AccountPageProps } from "./pages/account.js";
import type { ConsentPageProps } from "./pages/consent.js";
import { ExplorePage } from "./pages/explore.js";
import { LandingPage } from "./pages/landing.js";
import type { LegalPageProps } from "./pages/legal.js";
import type { MountPageProps } from "./pages/mount.js";
import type { OwnerPageProps } from "./pages/owner.js";
import type { SignInPageProps } from "./pages/sign-in.js";
import { BadAddressPage, NotFoundPage } from "./pages/simple.js";
import { matchRoute, type Route } from "./router.js";
import { applyHead, buildHead } from "./seo/head.js";

/**
 * The pages that are not on the way of every visitor: the explorer view and the deployment's own
 * pages bring the Markdown renderer with them, and the page of an account, the sign-in page, the
 * pages of whoever is signed in and the consent page are for the few who go there. In the
 * browser each loads when someone opens it. The server, which renders them, passes the
 * components in instead (entry-server.tsx).
 */
export interface PageComponents {
  readonly mount: ComponentType<MountPageProps>;
  readonly legal: ComponentType<LegalPageProps>;
  readonly owner: ComponentType<OwnerPageProps>;
  readonly signIn: ComponentType<SignInPageProps>;
  readonly account: ComponentType<AccountPageProps>;
  readonly consent: ComponentType<ConsentPageProps>;
}

const LAZY_PAGES: PageComponents = {
  mount: lazy(() => import("./pages/mount.js").then((module) => ({ default: module.MountPage }))),
  legal: lazy(() => import("./pages/legal.js").then((module) => ({ default: module.LegalPage }))),
  owner: lazy(() => import("./pages/owner.js").then((module) => ({ default: module.OwnerPage }))),
  signIn: lazy(() =>
    import("./pages/sign-in.js").then((module) => ({ default: module.SignInPage })),
  ),
  account: lazy(() =>
    import("./pages/account.js").then((module) => ({ default: module.AccountPage })),
  ),
  consent: lazy(() =>
    import("./pages/consent.js").then((module) => ({ default: module.ConsentPage })),
  ),
};

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
  /** The pages that must render at once rather than load: what the server renders. */
  readonly pages?: Partial<PageComponents>;
  /**
   * The language a URL without one is shown in: the visitor's choice (which a URL that forces a
   * language makes) or their browser's, read by the browser entry. The server passes the one the
   * request asked for (ADR-0021); prerendering leaves it out and renders the default.
   */
  readonly preferredLanguage?: Language;
}

function pageOf(route: Route, origin: string, pages: PageComponents): ReactNode {
  switch (route.name) {
    case "landing":
      return <LandingPage origin={origin} />;
    case "explore":
      return <ExplorePage origin={origin} />;
    case "mount":
      return <pages.mount origin={origin} address={route.address} view={route.view} />;
    case "owner":
      return <pages.owner origin={origin} owner={route.owner} />;
    case "sign-in":
      return <pages.signIn origin={origin} />;
    case "account":
      return <pages.account origin={origin} section={route.section} />;
    case "consent":
      return <pages.consent origin={origin} />;
    case "legal":
      return <pages.legal origin={origin} kind={route.kind} />;
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

/** The routes whose pages write their own heads once they know what they show. */
const OWN_HEAD: ReadonlySet<Route["name"]> = new Set([
  "mount",
  "landing",
  "legal",
  "owner",
  "sign-in",
  "account",
  "consent",
]);

function Routed(props: {
  readonly origin: string;
  readonly shell: boolean;
  readonly pages: PageComponents;
  readonly preferredLanguage: Language | undefined;
}) {
  const location = useLocation();
  const language = resolveLanguage(location.search, props.preferredLanguage);
  const i18n = useMemo(() => ({ language, t: messagesFor(language) }), [language]);
  const route = matchRoute(location.pathname, location.search, import.meta.env.DEV);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the route is a function of the location
  useEffect(() => {
    if (!OWN_HEAD.has(route.name)) {
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
          <Suspense fallback={placeholder}>{pageOf(route, props.origin, props.pages)}</Suspense>
        )}
      </Layout>
    </I18nContext.Provider>
  );
}

export function App(props: AppProps) {
  const [preferred, setPreferred] = useState(props.preferredLanguage);
  const preference = useMemo(() => ({ preferred, setPreferred }), [preferred]);
  const pages = useMemo(() => ({ ...LAZY_PAGES, ...props.pages }), [props.pages]);
  return (
    <InitialDataContext.Provider value={props.initialData ?? {}}>
      <LanguagePreferenceContext.Provider value={preference}>
        <LocationProvider initial={props.initialLocation}>
          {/* Who is signed in is one fact for the whole page: the header, and whatever page
              shows something that is a person's, read it from here. */}
          <SessionProvider>
            {/* And so are the deployment's terms and privacy policy: the footer links to them,
                and whoever signs in is told that they agree to them. */}
            <LegalLinksProvider>
              <Routed
                origin={props.origin}
                shell={props.shell === true}
                pages={pages}
                preferredLanguage={preferred}
              />
            </LegalLinksProvider>
          </SessionProvider>
        </LocationProvider>
      </LanguagePreferenceContext.Provider>
    </InitialDataContext.Provider>
  );
}
