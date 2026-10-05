import type { RestUser } from "@skillcdn/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Session, SessionContext } from "../auth/session.js";
import { I18nContext, messagesFor } from "../i18n/index.js";
import { LANGUAGES, type Language } from "../i18n/languages.js";
import { LegalLinksContext } from "../legal-links.js";
import { LocationProvider } from "../navigation.js";
import { SignInPage } from "./sign-in.js";

const USER: RestUser = {
  host: "gh",
  login: "octo-dev",
  name: null,
  avatar: "https://avatars.example/octo-dev.png",
};

function render(language: Language, search: string, session: Session): string {
  return renderToStaticMarkup(
    <I18nContext value={{ language, t: messagesFor(language) }}>
      <LocationProvider initial={{ pathname: "/login", search }}>
        <SessionContext
          value={{ session, refresh: () => undefined, signOut: async () => undefined }}
        >
          <LegalLinksContext value={{ termsUrl: "https://skills.example/terms" }}>
            <SignInPage origin="https://skills.example" />
          </LegalLinksContext>
        </SessionContext>
      </LocationProvider>
    </I18nContext>,
  );
}

const ANONYMOUS: Session = { status: "anonymous" };

describe("the sign-in page", () => {
  it.each(LANGUAGES)("says what signing in is for and shows the one way out, in %s", (language) => {
    const t = messagesFor(language);
    const html = render(
      language,
      "?return_to=%2Fgh%2Facme%2Fprivate-skills%3Flang%3Dko",
      ANONYMOUS,
    );
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain(t.auth.page.title);
    expect(html).toContain(t.auth.page.lead);
    expect(html).toContain(t.auth.continueWith);
    // The page to come back to travels on, as it came.
    expect(html).toContain(
      'href="/auth/gh/login?return_to=%2Fgh%2Facme%2Fprivate-skills%3Flang%3Dko"',
    );
    expect(html).toContain(t.auth.agreement.termsName);
    for (const failure of Object.values(t.auth.failures)) {
      expect(html).not.toContain(failure.title);
    }
  });

  it("comes back to the account pages for someone who came with nowhere to go back to", () => {
    for (const search of [
      "",
      "?lang=ko",
      // Not a page of this origin, and the sign-in page again, which would only send them round.
      "?return_to=https%3A%2F%2Fevil.test%2F",
      "?return_to=%2F%2Fevil.test",
      "?return_to=%2F%5Cevil.test",
      "?return_to=explore",
      "?return_to=%2Flogin%3Freturn_to%3D%252Fexplore",
    ]) {
      const html = render("en", search, ANONYMOUS);
      expect(html, search).toContain('href="/auth/gh/login?return_to=%2Faccount"');
      expect(html, search).not.toContain("evil.test");
    }
  });

  it.each(LANGUAGES)(
    "says why a sign-in did not complete, and offers it again, in %s",
    (language) => {
      const t = messagesFor(language);
      for (const failure of ["denied", "expired", "failed"] as const) {
        const html = render(language, `?error=${failure}&return_to=%2Fexplore`, ANONYMOUS);
        expect(html, failure).toContain(t.auth.failures[failure].title);
        expect(html, failure).toContain(t.auth.failures[failure].body);
        expect(html, failure).toContain('href="/auth/gh/login?return_to=%2Fexplore"');
      }
      // A code this page does not know is nothing it can explain.
      const unknown = render(language, "?error=server_on_fire", ANONYMOUS);
      for (const failure of Object.values(t.auth.failures)) {
        expect(unknown).not.toContain(failure.title);
      }
      expect(unknown).toContain(t.auth.continueWith);
    },
  );

  it("offers nothing before it knows who is there, and nothing to someone signed in", () => {
    const t = messagesFor("en");
    for (const session of [{ status: "unknown" }, { status: "user", user: USER }] as const) {
      const html = render("en", "?return_to=%2Fexplore", session);
      expect(html, session.status).toContain(t.common.loading);
      expect(html, session.status).not.toContain("/auth/gh/login");
      expect(html, session.status).not.toContain(t.auth.page.title);
    }
    // Where nobody can sign in, there is no such page.
    const disabled = render("en", "", { status: "disabled" });
    expect(disabled).toContain(t.notFound.title);
    expect(disabled).not.toContain("/auth/gh/login");
  });
});
