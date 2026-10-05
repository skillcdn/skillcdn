import type { RestUser } from "@skillcdn/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Session, SessionContext } from "../auth/session.js";
import { I18nContext, messagesFor } from "../i18n/index.js";
import { LANGUAGES, type Language } from "../i18n/languages.js";
import { LegalLinksContext } from "../legal-links.js";
import { LocationProvider } from "../navigation.js";
import { SignInDialogProvider } from "./sign-in-dialog.js";

const USER: RestUser = {
  host: "gh",
  login: "octo-dev",
  name: null,
  avatar: "https://avatars.example/octo-dev.png",
};

/** A page as the server sent the browser to it, for whoever the session says is there. */
function render(language: Language, pathname: string, search: string, session: Session): string {
  return renderToStaticMarkup(
    <I18nContext value={{ language, t: messagesFor(language) }}>
      <LocationProvider initial={{ pathname, search }}>
        <SessionContext
          value={{ session, refresh: () => undefined, signOut: async () => undefined }}
        >
          <LegalLinksContext value={{ termsUrl: "https://skills.example/terms" }}>
            <SignInDialogProvider>
              <p>the page</p>
            </SignInDialogProvider>
          </LegalLinksContext>
        </SessionContext>
      </LocationProvider>
    </I18nContext>,
  );
}

const ANONYMOUS: Session = { status: "anonymous" };

describe("the sign-in dialog", () => {
  it.each(LANGUAGES)(
    "opens over the page the server asked it on, with the one way out and back to that page, in %s",
    (language) => {
      const t = messagesFor(language);
      const html = render(
        language,
        "/gh/acme/private-skills",
        "?skill=a%20b&sign_in=open",
        ANONYMOUS,
      );
      expect(html).toContain("<p>the page</p>");
      expect(html.match(/<dialog[ >]/g)).toHaveLength(1);
      // The page has its own first heading; the dialog is named by a second one.
      expect(html).not.toMatch(/<h1[ >]/);
      expect(html).toContain(t.auth.dialog.title);
      expect(html).toContain(t.auth.dialog.lead);
      expect(html).toContain(`aria-label="${t.auth.dialog.close}"`);
      expect(html).toContain(t.auth.continueWith);
      // Back to the page as it was, without what asked for the dialog.
      expect(html).toContain(
        'href="/auth/gh/login?return_to=%2Fgh%2Facme%2Fprivate-skills%3Fskill%3Da%2520b"',
      );
      expect(html).toContain(t.auth.agreement.termsName);
      for (const failure of Object.values(t.auth.failures)) {
        expect(html).not.toContain(failure.title);
      }
      expect(html).not.toContain('style="');
    },
  );

  it.each(LANGUAGES)(
    "says why a sign-in did not complete, and offers it again, in %s",
    (language) => {
      const t = messagesFor(language);
      for (const failure of ["denied", "expired", "failed"] as const) {
        const html = render(language, "/explore", `?sign_in=${failure}`, ANONYMOUS);
        expect(html, failure).toContain(t.auth.failures[failure].title);
        expect(html, failure).toContain(t.auth.failures[failure].body);
        expect(html, failure).toContain('href="/auth/gh/login?return_to=%2Fexplore"');
      }
    },
  );

  it("stays shut on a page that was not asked, and for a word it does not know", () => {
    for (const search of [
      "",
      "?lang=ko",
      "?sign_in=",
      "?sign_in=server_on_fire",
      "?error=denied",
    ]) {
      const html = render("en", "/explore", search, ANONYMOUS);
      expect(html, search).toBe("<p>the page</p>");
    }
  });

  it("offers nothing before it knows who is there, to someone signed in, or where nobody signs in", () => {
    for (const session of [
      { status: "unknown" },
      { status: "user", user: USER },
      { status: "disabled" },
    ] as const) {
      const html = render("en", "/explore", "?sign_in=denied", session);
      expect(html, session.status).toBe("<p>the page</p>");
    }
  });
});
