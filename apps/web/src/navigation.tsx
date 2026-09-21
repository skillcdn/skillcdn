import {
  type AnchorHTMLAttributes,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { useI18n } from "./i18n/index.js";
import { withLanguage } from "./i18n/languages.js";

export interface AppLocation {
  readonly pathname: string;
  readonly search: string;
}

const NAVIGATED = "skillcdn:navigated";

const LocationContext = createContext<AppLocation>({ pathname: "/", search: "" });

function currentLocation(): AppLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

/** Moves to another page of the app without loading a document. */
export function navigate(href: string, options: { readonly replace?: boolean } = {}): void {
  if (options.replace === true) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new Event(NAVIGATED));
}

/** Holds the location: the one given while prerendering, the browser's afterwards. */
export function LocationProvider(props: {
  readonly initial: AppLocation;
  readonly children: ReactNode;
}) {
  const [location, setLocation] = useState(props.initial);
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATED, update);
    };
  }, []);
  return <LocationContext.Provider value={location}>{props.children}</LocationContext.Provider>;
}

export function useLocation(): AppLocation {
  return useContext(LocationContext);
}

/** An href inside the app, in the current language. */
export function useHref(): (href: string) => string {
  const { language } = useI18n();
  return (href) => withLanguage(href, language);
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A link to a page of the app. It is a real anchor with a real href, in the current language,
 * so it works without scripts, for crawlers, and with "open in new tab".
 */
export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    readonly href: string;
    /** Keep the href as it is, for links that change the language. */
    readonly exact?: boolean;
  },
) {
  const { href, exact, onClick, children, ...rest } = props;
  const localized = useHref();
  const target = exact === true ? href : localized(href);
  return (
    <a
      {...rest}
      href={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainLeftClick(event) || rest.target !== undefined) {
          return;
        }
        event.preventDefault();
        navigate(target);
      }}
    >
      {children}
    </a>
  );
}
