import {
  REFERENCE_REPOSITORY_ADDRESS,
  type RestBrowse,
  type RestFeatured,
  type RestLegalDocument,
  type RestMount,
  type RestShowcase,
  type RestSkill,
} from "@skillcdn/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./app.js";
import {
  LANGUAGES,
  ORIGIN_PLACEHOLDER,
  renderAddressPage,
  renderDocument,
  renderLandingPage,
  renderLegalPage,
  renderLlmsTxt,
  renderNotFound,
  renderPage,
  renderShell,
  STATIC_PAGES,
  TEMPLATE_MARKERS,
} from "./entry-server.js";
import { messagesFor } from "./i18n/index.js";
import { defaultShowcase } from "./showcase.js";
import { DEFAULT_SHOWCASE_MEDIA } from "./site.js";

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

const MEDIA_URL = (letter: string) => `/media/${letter.repeat(64)}`;

/** An operator's showcase: one entry with a clip, words in two languages, and a demo in one. */
const SHOWCASE: RestShowcase = {
  items: [
    {
      id: "spring-ad",
      address: "/gh/acme/skills",
      position: 0,
      width: 640,
      height: 480,
      durationMs: 8000,
      published: "2026-10-01",
      media: {
        clip: { url: MEDIA_URL("a"), type: "video/mp4" },
        animation: null,
        poster: { url: MEDIA_URL("b"), type: "image/webp" },
        reference: { url: MEDIA_URL("c"), type: "image/webp" },
        picture: null,
        social: { url: MEDIA_URL("d"), type: "image/png" },
      },
      texts: {
        en: {
          title: "A spring ad from one picture",
          body: "Show it a picture of your product and get an ad for the season.",
          tags: ["One picture in", "Ready to post"],
          action: "Make one",
          requirement: "Uses a video tool",
          clip: "A bottle on a garden table in spring light.",
          credit: "Made by Acme",
          demo: {
            prompt: "Make a spring ad from this picture.",
            reference: "Reference picture",
            picture: "Product picture",
            question: "What should it say?",
            answer: "Keep it light.",
            plan: "Three scenes in a garden. Here is the plan.",
            approval: "Plan reviewed",
            consent: "Go ahead.",
            working: "Making it…",
            result: "Your spring ad, three scenes in a garden.",
          },
        },
        ko: {
          title: "사진 한 장으로 만드는 봄 광고",
          body: "제품 사진을 보여 주면 계절에 맞는 광고가 나옵니다.",
          tags: [],
          action: "만들어 보기",
          requirement: null,
          clip: null,
          credit: null,
          demo: null,
        },
      },
    },
  ],
};

// What the build writes into the prerendered files, rendered here without a browser.

describe("prerendered pages", () => {
  it("preserves operator recommendations while excluding duplicate picks and retired fixtures", () => {
    const item = (address: string): RestFeatured["items"][number] => ({
      address,
      repository: MOUNT.repository,
      manifest: null,
      verified: false,
      status: "ready",
      skillCount: 1,
      skills: ["review"],
    });
    const items = [
      REFERENCE_REPOSITORY_ADDRESS,
      "/gh/SkillCDN/skills",
      "/gh/acme/useful",
      "/gh/Acme/useful",
      "/gh/skillcdn/skillcdn@release/1.2:skills/hostile",
      "/gh/skillcdn/skillcdn@main/skills/single-skill/references",
      "/gh/skillcdn/skillcdn/skills/hostile-tools",
      "/gh/skillcdn/skills@v1",
    ].map(item);
    const body = renderToString(
      <App
        initialLocation={{ pathname: "/explore", search: "" }}
        origin={ORIGIN_PLACEHOLDER}
        initialData={{ featured: { ready: { items } } }}
      />,
    );
    expect(body.match(/href="\/gh\/acme\/useful"/g)).toHaveLength(1);
    // One card for the reference repository, whichever way it was written (the address form
    // links to it as well, as the example to try), and four cards in all.
    expect(body.match(/<h3[^>]*><a[^>]*href="\/gh\/skillcdn\/skills"/g)).toHaveLength(1);
    expect(body.match(/<h3/g)).toHaveLength(4);
    expect(body).not.toContain('skills/hostile"');
    expect(body).not.toContain("single-skill/references");
    expect(body).not.toContain('href="/gh/SkillCDN/skills"');
    expect(body).toContain('href="/gh/skillcdn/skillcdn/skills/hostile-tools"');
    expect(body).toContain('href="/gh/skillcdn/skills@v1"');
  });

  it("leads the front page with the build's own showcase, before repository setup", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const { body } = renderPage("/", language);
      expect(body).toContain(`href="${REFERENCE_REPOSITORY_ADDRESS}"`);
      expect(body).toContain(t.landing.featured.video.title);
      expect(body.indexOf(t.landing.featured.video.title)).toBeLessThan(
        body.indexOf('inputMode="url"'),
      );
      expect(body).not.toMatch(/href="\/gh\/skillcdn\/skillcdn/);
      // The clip is local, waits to be seen before it loads, and plays without sound.
      expect(body).toMatch(/<video[^>]+src="\/showcase\/[^"]+\.mp4"/);
      expect(body).toContain(`src="${DEFAULT_SHOWCASE_MEDIA.clip}"`);
      expect(body).toContain(`poster="${DEFAULT_SHOWCASE_MEDIA.poster}"`);
      expect(body).toMatch(/<video[^>]+preload="none"/);
      expect(body).toMatch(/<video[^>]+muted=""/);
      expect(body).not.toMatch(/<video[^>]+autoplay/i);
      expect(body).toContain(t.landing.featured.video.clip);
      expect(body).not.toMatch(/style="|<(?:img|video)[^>]+src="https?:/);
      // The animated image is for a browser that refuses the video, so it is not in the page
      // until one does, and nothing is laid over the clip.
      expect(body).not.toContain(DEFAULT_SHOWCASE_MEDIA.animation);
      const card = body.slice(body.indexOf("<article"), body.indexOf("</article>"));
      expect(card).not.toContain("<button");
      // The explorer has its own list and no showcase card (ADR-0028).
      const explore = renderPage("/explore", language).body;
      expect(explore).not.toContain("<video");
      expect(explore).not.toContain(t.landing.featured.video.title);
    }
  });

  it("shows the operator's showcase on the front page instead of the build's own", () => {
    const t = messagesFor("ko");
    const { html, indexable } = renderLandingPage(TEMPLATE, {
      language: "ko",
      origin: "https://skills.example",
      pathname: "/",
      search: "?lang=ko",
      data: { showcase: { ready: SHOWCASE } },
    });
    expect(indexable).toBe(true);
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('data-prerendered="landing" data-lang="ko"');
    // The entry's words in the visitor's language, its media, and its address; not the build's.
    expect(html).toContain("사진 한 장으로 만드는 봄 광고");
    expect(html).toContain(`src="${MEDIA_URL("a")}"`);
    expect(html).toContain(`poster="${MEDIA_URL("b")}"`);
    expect(html).toContain('href="/gh/acme/skills"');
    expect(html).not.toContain(DEFAULT_SHOWCASE_MEDIA.clip);
    expect(html).not.toContain(t.landing.featured.video.title);
    // No example conversation in Korean: the build's own stands in, with its own media.
    expect(html).toContain(t.landing.demo.prompt);
    expect(html).toContain(DEFAULT_SHOWCASE_MEDIA.poster);
    // The browser continues from the same answer, and the head describes the entry's clip.
    expect(html).toContain('<script type="application/json" id="skillcdn-data">');
    expect(html).toContain(`"contentUrl":"https://skills.example${MEDIA_URL("a")}"`);
    expect(html).toContain(`content="https://skills.example${MEDIA_URL("d")}"`);

    // In English the entry brings its own conversation, played with the entry's own media.
    const english = renderLandingPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/",
      search: "",
      data: { showcase: { ready: SHOWCASE } },
    }).html;
    expect(english).toContain("Make a spring ad from this picture.");
    // What the person attaches is what the entry has: a reference here, and no picture.
    expect(english).toContain("(Reference picture)");
    expect(english).not.toContain("(Product picture)");
    expect(english).not.toContain(messagesFor("en").landing.demo.prompt);
    expect(english).not.toContain(DEFAULT_SHOWCASE_MEDIA.poster);

    // An empty showcase is the build's own, as the prerendered page has it.
    const empty = renderLandingPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/",
      search: "",
      data: { showcase: { ready: { items: [] } } },
    }).html;
    expect(empty).toContain(`src="${DEFAULT_SHOWCASE_MEDIA.clip}"`);
    expect(empty).toContain(defaultShowcase().texts.en?.title ?? "missing");
  });

  it("shows the spending consent without animation, and keeps the whole conversation for assistive technology", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      const { body, head } = renderPage("/", language);
      // Without a script the last scene stands: the consent and the result, with nothing over
      // the result and no title bar or stage list around the conversation.
      expect(body).toContain('data-demo-phase="2"');
      expect(body).toContain(t.landing.demo.approval);
      expect(body).toContain(t.landing.demo.consent);
      expect(body).toContain(`poster="${DEFAULT_SHOWCASE_MEDIA.poster}"`);
      expect(body).not.toContain(t.landing.demo.working);
      // Nothing to click through, but every line is there to be read.
      expect(body).toContain(`<ol class="visually-hidden" aria-label="${t.landing.demo.label}">`);
      for (const message of [
        t.landing.demo.prompt,
        t.landing.demo.question,
        t.landing.demo.answer,
        t.landing.demo.plan,
        t.landing.demo.result,
      ])
        expect(body).toContain(message);
      // The person brings the character: the picture is attached, and there is no reference.
      expect(body).toContain(`(${t.landing.demo.picture})`);
      expect(body).not.toContain(t.landing.demo.reference);
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
    // The crumbs lead back to the connected address, which the folder does not change.
    expect(html).toContain('href="/gh/acme/skills"');
    expect(html).not.toContain("https://skills.example/gh/acme/skills/team-a");
    // The connection guide belongs to the page of the address, not to a folder of it.
    expect(html).toContain(">Team review<");
    expect(html).not.toContain(messagesFor("en").connect.title);
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

  it("offers original introductions in each UI language without a repository manifest", () => {
    for (const language of LANGUAGES) {
      const { html } = renderAddressPage(TEMPLATE, {
        language,
        origin: "https://skills.example",
        pathname: "/gh/acme/skills",
        search: "",
        data: {
          mount: { ready: MOUNT },
          browse: {
            ready: {
              ...BROWSE,
              overview: {
                path: "README.md",
                title: "Original introduction",
                description: "Choose a skill for the task at hand.",
              },
              entries: [
                {
                  kind: "directory",
                  path: "engineering",
                  name: "Engineering",
                  description: null,
                  skillCount: 1,
                  documentCount: 0,
                  size: null,
                  manifestPath: null,
                  language: null,
                  overviewPath: "engineering/README.md",
                },
              ],
            },
          },
        },
      });
      expect(html).toContain(messagesFor(language).mount.browse.introduction);
      expect(html).toContain("Choose a skill for the task at hand.");
      expect(html).toContain('href="/gh/acme/skills?file=README.md"');
      expect(html).toContain('href="/gh/acme/skills?file=engineering%2FREADME.md"');
      expect(html).not.toContain("file=README.ko.md");
    }
  });

  it("shows indexing for a direct README link until publication is known", () => {
    const { html } = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?file=README.md",
      data: {
        mount: { ready: { ...MOUNT, index: { status: "indexing" } } },
      },
    });
    expect(html).toContain(messagesFor("en").mount.indexing.title);
    expect(html).not.toContain(messagesFor("en").errors.generic);
    const ready = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "?file=README.md",
      data: { mount: { ready: MOUNT } },
    });
    expect(ready.html).not.toContain(messagesFor("en").mount.indexing.title);
    expect(ready.html).not.toContain(messagesFor("en").errors.generic);
    expect(ready.html).toContain('aria-label="Repository folders"');
    expect(ready.html).toContain(
      `<span class="visually-hidden">${messagesFor("en").common.loading}</span>`,
    );
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

  it("writes repository text that looks like a replacement pattern as it is", () => {
    // `$&`, `$'` and the like mean something to a string replacement; a page must not.
    const patterns = "Prices in $& and $` or $' for $$1 $<name>";
    const html = renderDocument(TEMPLATE, {
      htmlLang: "en",
      head: `<title>${patterns}</title>`,
      body: `<p>${patterns}</p>`,
      routeName: "landing",
    });
    expect(html).toContain(`<title>${patterns}</title>`);
    expect(html).toContain(`<p>${patterns}</p>`);
    expect(html.match(/<head>/g)).toHaveLength(1);
    expect(html.match(/<body>/g)).toHaveLength(1);

    const address = renderAddressPage(TEMPLATE, {
      language: "en",
      origin: "https://skills.example",
      pathname: "/gh/acme/skills",
      search: "",
      data: {
        mount: {
          ready: {
            ...MOUNT,
            repository: { ...MOUNT.repository, description: patterns },
          },
        },
      },
    });
    // The same text once as JSON for the browser (with `<` escaped) and once as HTML.
    expect(address.html).toContain('"description":"Prices in $& and $` or $\' for $$1 $');
    expect(address.html).toContain("Prices in $&amp; and $` or $&#x27; for $$1 $&lt;name&gt;");
    expect(address.html.match(/<body>/g)).toHaveLength(1);
  });
});

describe("a page of the deployment's own", () => {
  const ENGLISH = {
    title: "Terms of service",
    body: "Be **kind**, and read the [privacy policy](/privacy).\n\n## Scope\n\nEverything here.",
  };
  const TERMS: RestLegalDocument = {
    kind: "terms",
    revised: "2026-10-01",
    texts: { en: ENGLISH, ko: { title: "이용약관", body: "친절하세요." } },
  };
  const origin = "https://skills.example";

  it("renders the document as Markdown in the visitor's language, with a head that says so", () => {
    const { html, indexable } = renderLegalPage(TEMPLATE, {
      language: "en",
      origin,
      pathname: "/terms",
      search: "",
      data: { legal: { ready: TERMS } },
    });
    expect(indexable).toBe(true);
    expect(html).toContain('data-prerendered="legal" data-lang="en"');
    expect(html).toContain(">Terms of service</h1>");
    expect(html).toContain("<strong>kind</strong>");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain(">Scope</h2>");
    expect(html).toContain(messagesFor("en").legal.revised("2026-10-01"));
    expect(html).toContain('<title data-head="">Terms of service | SkillCDN</title>');
    expect(html).toContain('<link rel="canonical" href="https://skills.example/terms"');
    expect(html).toContain(
      '<meta name="description" content="Be kind, and read the privacy policy."',
    );
    expect(html).toContain('<script type="application/json" id="skillcdn-data">');
    // The visitor's language when it was written in it, else the default language.
    const korean = renderLegalPage(TEMPLATE, {
      language: "ko",
      origin,
      pathname: "/terms",
      search: "?lang=ko",
      data: { legal: { ready: TERMS } },
    }).html;
    expect(korean).toContain(">이용약관</h1>");
    expect(korean).toContain("친절하세요.");
    expect(korean).not.toContain("<strong>kind</strong>");
    const fallback = renderLegalPage(TEMPLATE, {
      language: "ko",
      origin,
      pathname: "/terms",
      search: "?lang=ko",
      data: { legal: { ready: { ...TERMS, texts: { en: ENGLISH } } } },
    }).html;
    expect(fallback).toContain(">Terms of service</h1>");
    expect(fallback).toContain('<html lang="ko">');
  });

  it("is not there when it has not been written", () => {
    const { html, indexable } = renderLegalPage(TEMPLATE, {
      language: "en",
      origin,
      pathname: "/privacy",
      search: "",
      data: {
        legal: {
          error: {
            status: 404,
            code: "legal.not_found",
            message: "This page has not been written.",
          },
        },
      },
    });
    expect(indexable).toBe(false);
    expect(html).toContain(messagesFor("en").notFound.title);
    expect(html).toContain('content="noindex,follow"');
    expect(html).toContain('<title data-head="">Privacy | SkillCDN</title>');
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
      expect(text).toContain(`${ORIGIN_PLACEHOLDER}${REFERENCE_REPOSITORY_ADDRESS}`);
      expect(text).toContain(t.landing.featured.video.title);
      expect(text).not.toContain("</");
    }
  });

  it("names the operator's showcase when there is one", () => {
    const text = renderLlmsTxt("en", SHOWCASE);
    expect(text).toContain(
      `- [A spring ad from one picture](${ORIGIN_PLACEHOLDER}/gh/acme/skills): Show it a picture`,
    );
    expect(text).toContain("Uses a video tool.");
    expect(text).not.toContain(messagesFor("en").landing.featured.video.title);
  });
});
