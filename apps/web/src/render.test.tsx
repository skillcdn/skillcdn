import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  ORIGIN_PLACEHOLDER,
  renderLlmsTxt,
  renderNotFound,
  renderPage,
  renderShell,
  STATIC_PAGES,
} from "./entry-server.js";
import { messagesFor } from "./i18n/index.js";

// What the build writes into the prerendered files, rendered here without a browser.

describe("prerendered pages", () => {
  it("exist once per language, with their content in the HTML itself", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const landing = renderPage("/", language);
      expect(landing.htmlLang).toBe(language);
      expect(landing.routeName).toBe("landing");
      expect(landing.body).toContain(t.landing.title);
      for (const item of t.landing.faq.items) {
        expect(landing.body, item.question).toContain(item.question);
      }
      expect(landing.head).toContain(`<title data-head="">${t.meta.landing.title}</title>`);

      const explore = renderPage("/explore", language);
      expect(explore.routeName).toBe("explore");
      expect(explore.body).toContain(t.explore.title);
    }
    expect(STATIC_PAGES.map((page) => page.path)).toEqual(["/", "/explore"]);
  });

  it("link to each other in the language they are in, and to the other languages", () => {
    const korean = renderPage("/", "ko").body;
    expect(korean).toContain('href="/explore?lang=ko"');
    expect(korean).toContain('hrefLang="en"');
    expect(korean).toContain('href="/?lang=ko"');
    const english = renderPage("/", "en").body;
    expect(english).toContain('href="/explore"');
    expect(english).not.toContain('href="/explore?lang=');
  });

  it("carry a placeholder where the public origin goes", () => {
    const landing = renderPage("/", "en");
    expect(landing.head).toContain(`href="${ORIGIN_PLACEHOLDER}/"`);
    expect(landing.body).toContain(`${ORIGIN_PLACEHOLDER.replace("https://", "")}/gh/owner/repo`);
  });

  it("include a frame for pages that render in the browser, and a page for what is missing", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const shell = renderShell(language);
      expect(shell.routeName).toBe("shell");
      expect(shell.head).toContain("noindex");
      expect(shell.body).toContain(t.nav.explore);
      expect(shell.body).not.toContain(t.landing.title);

      const missing = renderNotFound(language);
      expect(missing.routeName).toBe("not-found");
      expect(missing.head).toContain("noindex");
      expect(missing.body).toContain(t.notFound.title);
    }
  });
});

describe("llms.txt", () => {
  it("describes the site in plain Markdown, per language", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const text = renderLlmsTxt(language);
      expect(text.startsWith(`# ${t.meta.siteName}\n\n> ${t.meta.landing.description}\n`)).toBe(
        true,
      );
      expect(text).toContain(`## ${t.landing.faq.title}`);
      expect(text).toContain(`${ORIGIN_PLACEHOLDER}/gh/owner/repo`);
      expect(text).not.toContain("</");
    }
  });
});
