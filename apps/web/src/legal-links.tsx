import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type LegalLinks, readLegalLinks } from "./site.js";

// The deployment's terms, its privacy policy and whom to write to, for whatever on a page shows
// them: the footer, and the place where a person agrees to them by signing in.

/**
 * `undefined` until the page is up. The server writes the links into the head of the document,
 * not into what is rendered, so they are read once the page is up: prerendered markup has none,
 * and the first render in the browser must match it.
 */
export const LegalLinksContext = createContext<LegalLinks | undefined>(undefined);

export function LegalLinksProvider(props: { readonly children: ReactNode }) {
  const [links, setLinks] = useState<LegalLinks>();
  useEffect(() => {
    setLinks(readLegalLinks());
  }, []);
  return <LegalLinksContext.Provider value={links}>{props.children}</LegalLinksContext.Provider>;
}

/** The links, each only where the deployment has it; `undefined` while they are not read yet. */
export function useLegalLinks(): LegalLinks | undefined {
  return useContext(LegalLinksContext);
}
