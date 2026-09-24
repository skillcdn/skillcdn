import type { RestBrowse, RestFeatured, RestMount, RestSkill } from "@skillcdn/core";
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
import { FEATURED_VIDEO } from "./site.js";

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
        translations: {},
      },
    ],
    documents: [{ path: "README.md", title: "Skills", summary: null }],
    diagnostics: [],
  },
};

const BROWSE: RestBrowse = {
  status: "ready",
  commit: MOUNT.commit,
  path: "",
  nextCursor: null,
  entries: [
    {
      kind: "skill",
      path: "review/SKILL.md",
      name: "review",
      description: "Reviews <b>changes</b>.</script><script>alert(1)</script>",
      skillCount: 1,
      documentCount: 0,
      size: null,
      manifestPath: null,
      language: null,
    },
  ],
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
    included: [],
    warnings: [],
    rules: null,
    translations: {},
  },
};

// What the build writes into the prerendered files, rendered here without a browser.

describe("prerendered pages", () => {
  it("preserves operator recommendations while excluding duplicate picks and retired fixtures", () => {
    const item = (address: string): RestFeatured["items"][number] => ({
      address,
      repository: MOUNT.repository,
      manifest: null,
      status: "ready",
      skillCount: 1,
      skills: ["review"],
    });
    const items = [
      FEATURED_VIDEO.address,
      "/gh/SkillCDN/examples",
      "/gh/acme/useful",
      "/gh/Acme/useful",
      "/gh/skillcdn/skillcdn@release/1.2:skills/hostile",
      "/gh/skillcdn/skillcdn@main/skills/single-skill/references",
      "/gh/skillcdn/skillcdn/skills/hostile-tools",
      "/gh/skillcdn/examples@v1",
    ].map(item);
    const body = renderToString(
      <App
        initialLocation={{ pathname: "/explore", search: "" }}
        origin={ORIGIN_PLACEHOLDER}
        initialData={{ featured: { ready: { items } } }}
      />,
    );
    expect(body.match(/href="\/gh\/acme\/useful"/g)).toHaveLength(1);
    expect(body).not.toContain('skills/hostile"');
    expect(body).not.toContain("single-skill/references");
    expect(body).not.toContain('href="/gh/SkillCDN/examples"');
    expect(body).toContain('href="/gh/skillcdn/skillcdn/skills/hostile-tools"');
    expect(body).toContain('href="/gh/skillcdn/examples@v1"');
  });

  it("offers the real editorial skill before repository setup on both public pages", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      for (const path of ["/", "/explore"]) {
        const { body } = renderPage(path, language);
        expect(body).toContain(`href="${FEATURED_VIDEO.href}"`);
        expect(body).toContain(t.landing.featured.video.title);
        expect(body.indexOf(t.landing.featured.video.title)).toBeLessThan(
          body.indexOf('inputMode="url"'),
        );
        expect(body).not.toMatch(/href="\/gh\/skillcdn\/skillcdn/);
        // The clip is local, waits to be seen before it loads, and plays without sound.
        expect(body).toMatch(/<video[^>]+src="\/showcase\/[^"]+\.mp4"/);
        expect(body).toContain(`src="${FEATURED_VIDEO.clip}"`);
        expect(body).toContain(`poster="${FEATURED_VIDEO.poster}"`);
        expect(body).toMatch(/<video[^>]+preload="none"/);
        expect(body).toMatch(/<video[^>]+muted=""/);
        expect(body).not.toMatch(/<video[^>]+autoplay/i);
        expect(body).toContain(t.landing.featured.video.clip);
        expect(body).not.toMatch(/style="|<(?:img|video)[^>]+src="https?:/);
        // The animated image is for a browser that refuses the video, so it is not in the page
        // until one does, and nothing is laid over the clip.
        expect(body).not.toContain(FEATURED_VIDEO.animation);
        const card = body.slice(body.indexOf("<article"), body.indexOf("</article>"));
        expect(card).not.toContain("<button");
      }
    }
  });

  it("shows the spending consent without animation, and keeps the whole conversation for assistive technology", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const { body, head } = renderPage("/", language);
      // Without a script the last scene stands: the consent and the result.
      expect(body).toContain('data-demo-phase="2"');
      expect(body).toContain(t.landing.demo.approval);
      expect(body).toContain(t.landing.demo.consent);
      expect(body).toContain(t.landing.demo.resultLabel);
      // Nothing to click through, but every line is there to be read.
      expect(body).toContain(`<ol class="visually-hidden" aria-label="${t.landing.demo.label}">`);
      for (const message of [
        t.landing.demo.prompt,
        t.landing.demo.question,
        t.landing.demo.answer,
        t.landing.demo.plan,
      ])
        expect(body).toContain(message);
      expect(t.landing.faq.items).toHaveLength(3);
      for (const item of t.landing.faq.items) expect(head).toContain(item.question);
    }
  });

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
      data: { mount: { ready: MOUNT }, browse: { ready: BROWSE } },
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
    expect(html).toContain(t.mount.search.hint);
    expect(html).toContain('aria-describedby="mount-search-hint"');
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

  it("renders a scoped folder from browse data and keeps the connection address", () => {
    const { html, indexable } = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?path=team-a",
      data: {
        mount: { ready: MOUNT },
        browse: {
          ready: {
            ...BROWSE,
            path: "team-a",
            entries: [
              {
                kind: "skill",
                path: "team-a/review/SKILL.md",
                name: "Team review",
                description: "Review this team's changes.",
                skillCount: 1,
                documentCount: 0,
                size: null,
                manifestPath: null,
                language: "en",
              },
            ],
          },
        },
      },
    });
    expect(indexable).toBe(false);
    expect(html).toContain('href="/gh/acme/skills?skill=team-a%2Freview%2FSKILL.md"');
    expect(html).toContain("https://skills.example/gh/acme/skills");
    expect(html).not.toContain("https://skills.example/gh/acme/skills/team-a");
    expect(html.indexOf(">Team review<")).toBeLessThan(
      html.indexOf(messagesFor("en").connect.title),
    );
  });

  it("renders one skill with its instructions, and says so when the index is not there yet", () => {
    const skill = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?skill=review%2FSKILL.md",
      data: { mount: { ready: MOUNT }, skill: { ready: SKILL } },
    });
    expect(skill.indexable).toBe(true);
    expect(skill.html).toContain("<strong>regressions</strong>");
    expect(skill.html).toContain("review · Acme/skills | SkillCDN");
    expect(skill.html).not.toContain(messagesFor("en").skill.translationNote);

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

  it("labels translated skill summaries while preserving the original name and instructions", () => {
    for (const language of LANGUAGES) {
      const translated = renderAddressPage(TEMPLATE, {
        language,
        origin: "https://skills.example",
        pathname: "/gh/acme/skills",
        search: "?skill=review%2FSKILL.md",
        data: {
          mount: { ready: MOUNT },
          skill: {
            ready: {
              ...SKILL,
              skill: {
                ...SKILL.skill,
                translations: {
                  [language]: { title: "Display review", description: "Display summary." },
                },
              },
            },
          },
        },
      });
      expect(translated.html).toContain(">Display review</h2>");
      expect(translated.html).toContain(">Display summary.</p>");
      expect(translated.html).toContain(messagesFor(language).skill.translationNote);
      expect(translated.html).toContain("<dd>review</dd>");
      expect(translated.html).toContain("<strong>regressions</strong>");
    }
  });

  it("labels a description-only translation in search and keeps original-language search guidance", () => {
    const t = messagesFor("en");
    const { html } = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?q=review",
      data: {
        mount: { ready: MOUNT },
        find: {
          ready: {
            status: "ready",
            query: "review",
            path: "",
            nextCursor: null,
            totals: null,
            items: [
              {
                kind: "skill",
                name: "review",
                directory: "review",
                description: "Reviews changes.",
                translations: { en: { title: null, description: "Display summary." } },
                files: [],
                moreFiles: 0,
              },
            ],
          },
        },
      },
    });
    expect(html).toContain(">review</span>");
    expect(html).toContain(">Display summary.</span>");
    expect(html).toContain(t.skill.translationNote);
    expect(html).toContain(t.mount.search.hint);
    expect(html).toContain('href="/gh/acme/skills?skill=review%2FSKILL.md"');
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

  it("renders a URL without a language in the one the server chose for the request", () => {
    const t = messagesFor("ko");
    const { html } = renderAddressPage(TEMPLATE, {
      language: "ko",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "",
      data: { mount: { ready: MOUNT }, browse: { ready: BROWSE } },
    });
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('data-prerendered="mount" data-lang="ko"');
    expect(html).toContain(t.connect.title);
    // It is the Korean page, whichever URL served it.
    expect(html).toContain(
      '<link rel="canonical" href="https://skills.example/gh/acme/skills?lang=ko"',
    );
  });

  it("is written into the same document as every prerendered page", () => {
    const html = renderDocument(TEMPLATE, renderPage("/", "ko"));
    expect(html).toContain('<html lang="ko">');
    // The root says what it holds, where no script before the app changes it.
    expect(html).toContain('data-prerendered="landing" data-lang="ko"');
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
      // What the site is, in one plain sentence, and what there is to make, with its address.
      expect(text).toContain(t.meta.landing.about);
      expect(text).toContain(`${ORIGIN_PLACEHOLDER}${FEATURED_VIDEO.href}`);
      expect(text).toContain(t.landing.featured.video.title);
      expect(text).not.toContain("</");
    }
  });
});
