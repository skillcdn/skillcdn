import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nContext, messagesFor } from "../i18n/index.js";
import { LANGUAGES, type Language } from "../i18n/languages.js";
import { LegalLinksContext } from "../legal-links.js";
import type { LegalLinks } from "../site.js";
import { SignIn } from "./sign-in.js";

const TERMS = "https://skills.example/terms";
const PRIVACY = "https://elsewhere.example/privacy";

function render(
  language: Language,
  legal: LegalLinks | undefined,
  props: { readonly returnTo?: string; readonly chooseAccount?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <I18nContext value={{ language, t: messagesFor(language) }}>
      <LegalLinksContext value={legal}>
        <SignIn
          returnTo={props.returnTo ?? "/gh/acme/skills"}
          chooseAccount={props.chooseAccount}
        />
      </LegalLinksContext>
    </I18nContext>,
  );
}

/** The text of a page, as someone reads it. */
const textOf = (html: string): string => html.replace(/<[^>]+>/g, "");

describe("the way out to the git host", () => {
  it.each(LANGUAGES)(
    "is one button that leaves to sign in and come back, with what it agrees to, in %s",
    (language) => {
      const t = messagesFor(language);
      const html = render(language, { termsUrl: TERMS, privacyUrl: PRIVACY });
      expect(html).toContain('href="/auth/gh/login?return_to=%2Fgh%2Facme%2Fskills"');
      expect(html).toContain(t.auth.continueWith);
      // The sentence of the pack, read through, with each name a link to its page that opens
      // beside this one.
      const { agreement } = t.auth;
      expect(textOf(html)).toContain(
        agreement.both
          .replace("{terms}", agreement.termsName)
          .replace("{privacy}", agreement.privacyName),
      );
      expect(html).toContain(
        `<a href="${TERMS}" target="_blank" rel="noopener noreferrer">${agreement.termsName}</a>`,
      );
      expect(html).toContain(
        `<a href="${PRIVACY}" target="_blank" rel="noopener noreferrer">${agreement.privacyName}</a>`,
      );
      expect(html).not.toContain("{");
      // Beside the button, the way to another account of the host.
      expect(html).toContain(
        'href="/auth/gh/login?return_to=%2Fgh%2Facme%2Fskills&amp;choose_account=1"',
      );
      expect(html).toContain(t.auth.switchAccount);
      expect(html).not.toContain('style="');
    },
  );

  it.each(LANGUAGES)("names only what the deployment has, in %s", (language) => {
    const { agreement } = messagesFor(language).auth;
    const terms = render(language, { termsUrl: TERMS });
    expect(textOf(terms)).toContain(agreement.terms.replace("{terms}", agreement.termsName));
    expect(terms).not.toContain(agreement.privacyName);
    const privacy = render(language, { privacyUrl: PRIVACY });
    expect(textOf(privacy)).toContain(
      agreement.privacy.replace("{privacy}", agreement.privacyName),
    );
    expect(privacy).not.toContain(agreement.termsName);
    // A deployment without either says nothing about agreeing, and still lets people in.
    const neither = render(language, {});
    expect(neither).not.toContain(agreement.termsName);
    expect(neither).not.toContain(agreement.privacyName);
    expect(neither).toContain('href="/auth/gh/login?return_to=%2Fgh%2Facme%2Fskills"');
  });

  it("marks every sentence of every language with the links it is used with", () => {
    for (const language of LANGUAGES) {
      const { agreement } = messagesFor(language).auth;
      const slots = (sentence: string) => sentence.match(/\{[a-z]+\}/g) ?? [];
      expect(slots(agreement.both).sort(), language).toEqual(["{privacy}", "{terms}"]);
      expect(slots(agreement.terms), language).toEqual(["{terms}"]);
      expect(slots(agreement.privacy), language).toEqual(["{privacy}"]);
    }
  });

  it("shows no button before it knows what the button agrees to", () => {
    const html = render("en", undefined);
    expect(html).not.toContain("/auth/gh/login");
    expect(html).toContain(messagesFor("en").common.loading);
  });

  it("has the host ask which account for someone who said the last one was not theirs", () => {
    const t = messagesFor("en");
    const html = render("en", { termsUrl: TERMS }, { returnTo: "/account", chooseAccount: true });
    expect(html).toContain('href="/auth/gh/login?return_to=%2Faccount&amp;choose_account=1"');
    // The button already does it, so the smaller way beside it is not offered twice.
    expect(html.match(/\/auth\/gh\/login/g)).toHaveLength(1);
    expect(html).not.toContain(t.auth.switchAccount);
  });
});
