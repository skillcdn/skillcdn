import type { RestMount, RestSkill } from "@skillcdn/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./app.js";
import {
  LANGUAGES,
  ORIGIN_PLACEHOLDER,
  renderAddressPage,
  renderDocument,
  renderLlmsTxt,
  renderNotFound,
  renderPage,
  renderShell,
  STATIC_PAGES,
  TEMPLATE_MARKERS,
} from "./entry-server.js";
import { messagesFor } from "./i18n/index.js";

const TEMPLATE = `<!doctype html>\n${TEMPLATE_MARKERS.htmlLang}<head>${TEMPLATE_MARKERS.head}</head><body>${TEMPLATE_MARKERS.root}</body></html>`;

const MOUNT: RestMount = {
  address: "/gh/acme/skills",
  repository: {
    host: "gh",
    owner: "Acme",
    name: "skills",
    defaultBranch: "main",
    description: "Skills for the whole team.",
  },
  ref: null,
  pinned: false,
  commit: "a".repeat(40),
  path: "",
  verified: false,
  index: {
    status: "ready",
    truncated: false,
    manifest: null,
    skillCount: 1,
    documentCount: 1,
    skills: [
      {
        name: "review",
        directory: "review",
        description: "Reviews <b>changes</b>.</script><script>alert(1)</script>",
        warnings: [],
      },
    ],
    documents: [{ path: "README.md", title: "Skills", summary: null }],
    diagnostics: [],
  },
};

const SKILL: RestSkill = {
  status: "ready",
  skill: {
    name: "review",
    directory: "review",
    description: "Reviews changes.",
    license: null,
    compatibility: null,
    allowedTools: null,
    metadata: {},
    body: "# Review\n\nLook for **regressions**.",
    files: ["review/SKILL.md"],
    filesTruncated: false,
    warnings: [],
    rules: null,
  },
};

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
      // Selecting a step changes the clip beside it, never what is on the page.
      for (const step of t.landing.how.steps) {
        expect(landing.body, step.title).toContain(step.title);
        expect(landing.body, step.title).toContain(step.body);
      }
      expect(landing.head).toContain(`<title data-head="">${t.meta.landing.title}</title>`);

      const explore = renderPage("/explore", language);
      expect(explore.routeName).toBe("explore");
      expect(explore.body).toContain(t.explore.title);
    }
    expect(STATIC_PAGES.map((page) => page.path)).toEqual(["/", "/explore"]);
  });

  it("link to each other without a language, and to the other languages", () => {
    // A forced language holds for one page: the Korean page links to clean URLs, and the
    // switcher still offers the URL of every language.
    const korean = renderPage("/", "ko").body;
    expect(korean).toContain(messagesFor("ko").landing.title);
    expect(korean).toContain('href="/explore"');
    expect(korean).not.toContain('href="/explore?lang=');
    expect(korean).toContain('hrefLang="en"');
    expect(korean).toContain('href="/?lang=ko"');
    const english = renderPage("/", "en").body;
    expect(english).toContain('href="/explore"');
    expect(english).not.toContain('href="/explore?lang=');
  });

  it("keep their links clean in a visitor's own language and in a forced one alike", () => {
    const preferred = renderToString(
      <App
        initialLocation={{ pathname: "/", search: "" }}
        origin={ORIGIN_PLACEHOLDER}
        preferredLanguage="ko"
      />,
    );
    expect(preferred).toContain(messagesFor("ko").landing.title);
    expect(preferred).toContain('href="/explore"');
    expect(preferred).not.toContain('href="/explore?lang=');
    // The switcher still offers the URL of every language, for crawlers and for sharing.
    expect(preferred).toContain('href="/?lang=ko"');

    const forced = renderToString(
      <App
        initialLocation={{ pathname: "/", search: "?lang=en" }}
        origin={ORIGIN_PLACEHOLDER}
        preferredLanguage="ko"
      />,
    );
    expect(forced).toContain(messagesFor("en").landing.title);
    expect(forced).toContain('href="/explore"');
    expect(forced).not.toContain('href="/explore?lang=');
  });

  it("carry a placeholder where the public origin goes", () => {
    const landing = renderPage("/", "en");
    expect(landing.head).toContain(`href="${ORIGIN_PLACEHOLDER}/"`);
    // The host in front of the address field is where the origin reaches the body.
    expect(landing.body).toContain(`${ORIGIN_PLACEHOLDER.replace("https://", "")}/gh/`);
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

describe("the page of an address", () => {
  it("renders what the address serves, with a head that says so and the data for the browser", () => {
    const { html, indexable } = renderAddressPage(TEMPLATE, {
      language: "ko",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?lang=ko",
      data: { mount: { ready: MOUNT } },
    });
    expect(indexable).toBe(true);
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('<title data-head="">Acme/skills | SkillCDN</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://skills.example/gh/acme/skills?lang=ko"',
    );
    expect(html).toContain('<meta name="robots" content="index,follow"');
    expect(html).toContain('data-prerendered="mount"');
    expect(html).toContain(">review<");
    // What comes from the repository is text in the page and cannot close the data element.
    expect(html).toContain("&lt;b&gt;changes&lt;/b&gt;");
    expect(html).toContain('<script type="application/json" id="skillcdn-data">');
    expect(html.slice(html.indexOf('id="skillcdn-data"')).match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<script>alert");
    // The browser continues with the origin the server rendered for.
    expect(html).toContain("skills.example/gh/acme/skills");
    // The description of the repository, then how to connect an agent: the endpoint, the steps
    // for the common clients, and what the agent is told when it connects.
    const t = messagesFor("ko");
    expect(html).toContain("Skills for the whole team.");
    expect(html).toContain(t.connect.title);
    expect(html.indexOf(t.connect.title)).toBeLessThan(html.indexOf(">review<"));
    // One tab per client; the first tab's steps are in the HTML, the others render on a click.
    for (const client of Object.values(t.connect.clients)) {
      expect(html).toContain(`>${client.label}<`);
    }
    expect(html).toContain(t.connect.clients.chatgpt.steps[0]);
    // The guide says what to say first; it no longer previews the server instructions.
    expect(html).toContain(t.connect.firstMessage.label);
    expect(html).not.toContain("This server serves");
  });

  it("renders one skill with its instructions, and says so when the index is not there yet", () => {
    const skill = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?skill=review",
      data: { mount: { ready: MOUNT }, skill: { ready: SKILL } },
    });
    expect(skill.indexable).toBe(true);
    expect(skill.html).toContain("<strong>regressions</strong>");
    expect(skill.html).toContain("review · Acme/skills | SkillCDN");

    const t = messagesFor("en");
    const indexing = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "",
      data: { mount: { ready: { ...MOUNT, index: { status: "indexing" } } } },
    });
    expect(indexing.indexable).toBe(false);
    expect(indexing.html).toContain(t.mount.indexing.title);
    expect(indexing.html).toContain('content="noindex,follow"');
  });

  it("explains an address that is nothing, or not an address, with the status left to the server", () => {
    const t = messagesFor("en");
    const missing = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/none",
      search: "",
      data: {
        mount: { error: { status: 404, code: "mount.repo_not_found", message: "Not there." } },
      },
    });
    expect(missing.indexable).toBe(false);
    expect(missing.html).toContain("Not there.");
    const bad = renderAddressPage(TEMPLATE, {
      language: "fr",
      origin: "https://skills.example",
      pathname: "/gh/acme",
      search: "",
      data: {},
    });
    expect(bad.indexable).toBe(false);
    expect(bad.html).toContain('<html lang="en">');
    expect(bad.html).toContain('data-prerendered="bad-address"');
    expect(bad.html).toContain(t.address.invalid);
  });

  it("is written into the same document as every prerendered page", () => {
    const html = renderDocument(TEMPLATE, renderPage("/", "ko"));
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('data-prerendered="landing"');
    expect(html).not.toContain("<!--app-");
    expect(html).not.toContain("skillcdn-data");
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
