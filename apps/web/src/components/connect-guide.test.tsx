import { parseAddress } from "@skillcdn/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nContext, messagesFor } from "../i18n/index.js";
import { previewPhase, typingClock } from "./connect-animation.js";
import { CLIENT_DETAILS, CONNECT_CLIENTS, clientConfiguration } from "./connect-clients.js";
import {
  ConnectGuide,
  claudeInstallLink,
  cursorInstallLink,
  serverNameOf,
  vscodeInstallLink,
} from "./connect-guide.js";
import { ConnectPreview } from "./connect-preview.js";

const parsed = parseAddress("/gh/acme/skills");
if (!parsed.ok) throw new Error("Invalid test address");
const address = parsed.value;

describe("connection onboarding", () => {
  it.each(["en", "ko"] as const)(
    "ships icons and a readable, localized walkthrough in %s",
    (language) => {
      const t = messagesFor(language);
      const html = renderToStaticMarkup(
        <I18nContext value={{ language, t }}>
          <ConnectGuide origin="https://skills.example" address={address} mount={undefined} />
        </I18nContext>,
      );
      expect(html).toContain("/clients/openai.svg");
      expect(html).toContain("/clients/claude.svg");
      expect(html).toContain("/clients/cursor.svg");
      expect(html).toContain('data-client="chatgpt"');
      expect(html.match(/data-client="chatgpt"/g)).toHaveLength(3);
      for (const title of t.connect.clients.chatgpt.titles) {
        expect(html).toContain(`aria-label="ChatGPT — ${title}"`);
      }
      expect(html).toContain('aria-current="step"');
      expect(html).toContain(t.connect.clients.chatgpt.steps[0]);
      expect(html).toContain("https://skills.example/gh/acme/skills");
      expect(html).not.toContain('style="');
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("aria-pressed=");
      expect(html.match(/aria-current="step"/g)).toHaveLength(1);
      for (const client of CONNECT_CLIENTS) {
        const icon = CLIENT_DETAILS[client].icon;
        if (icon !== undefined) expect(html).toContain(`/clients/${icon}.svg`);
        for (const step of [0, 1, 2]) {
          const scene = renderToStaticMarkup(
            <I18nContext value={{ language, t }}>
              <ConnectPreview
                client={client}
                step={step}
                name="my-skills"
                description="Skills for tests"
                url="https://skills.example/gh/acme/skills"
              />
            </I18nContext>,
          );
          const frame = scene.match(/<div[^>]*data-client="[^"]+"[^>]*>/)?.[0];
          expect(frame).not.toContain("inert");
          expect(frame).not.toContain("aria-hidden");
          expect(scene).toContain('aria-hidden="true"');
          expect(scene).not.toContain('style="');
          expect(scene).toContain(`>${t.connect.clients[client].label}<`);
          expect(scene).not.toContain("chatgpt.com");
          expect(scene).not.toContain("claude.ai");
        }
      }
    },
  );

  it("takes a two-click scene from the first click straight to the second pointer", () => {
    expect(previewPhase(1500, "clicks")).toBe("click");
    expect(previewPhase(1600, "clicks")).toBe("action");
    expect(previewPhase(1600, "click")).toBe("type");
    expect(previewPhase(2300, "clicks")).toBe("submit");
    expect(previewPhase(3000, "clicks")).toBe("done");
    expect(previewPhase(6400, "clicks")).toBe("still");
  });

  it("fills a form in the order a person does, each press after the pointer has arrived", () => {
    expect(previewPhase(0, "fill")).toBe("type");
    expect(typingClock(0, "fill")).toBe(1520);
    expect(previewPhase(2199, "fill")).toBe("type");
    // The list is reached, then opened; its entry sought, then picked; the button aimed at, then pressed.
    expect(
      [2200, 2900, 3200, 3900, 4200, 4900, 5300].map((time) => previewPhase(time, "fill")),
    ).toEqual(["reach", "open", "seek", "pick", "aim", "submit", "done"]);
    // The typed text stays whole from the moment the pointer sets out.
    expect(typingClock(2200, "fill")).toBe(3920);
    expect(typingClock(5000, "fill")).toBe(3920);
    expect(previewPhase(6400, "fill")).toBe("still");
  });

  it("offers the complete name and address as copy targets inside the form", () => {
    const scene = renderToStaticMarkup(
      <ConnectPreview
        client="claude"
        step={1}
        name="team-skills"
        description="Skills for tests"
        url="https://skills.example/gh/acme/skills@release/docs"
      />,
    );
    expect(scene).toContain('aria-label="Copy: team-skills"');
    expect(scene).toContain(
      'aria-label="Copy: https://skills.example/gh/acme/skills@release/docs"',
    );
    expect(scene).not.toContain("inert=");
  });

  it.each(["claudeCode", "codex", "gemini"] as const)(
    "keeps %s shell and in-app commands in separate copy targets",
    (client) => {
      const scene = renderToStaticMarkup(
        <ConnectPreview
          client={client}
          step={1}
          name="my-skills"
          description="Skills for tests"
          url="https://skills.example"
        />,
      );
      const launch = client === "claudeCode" ? "claude" : client;
      const check = client === "gemini" ? "/mcp list" : "/mcp";
      expect(scene).toContain(`aria-label="Copy: ${launch}"`);
      expect(scene).toContain(`aria-label="Copy: ${check}"`);
      expect(scene.match(/<button/g)).toHaveLength(2);
      expect(scene).not.toContain(`${launch}\n${check}`);
    },
  );

  it("keeps the mounted endpoint intact in install links and configurations", () => {
    const url = "https://skills.example/gh/acme/skills@release/1.2:docs";
    const name = "team-skills";
    const cursor = new URL(cursorInstallLink(name, url));
    expect(cursor.searchParams.get("name")).toBe(name);
    expect(JSON.parse(atob(cursor.searchParams.get("config") ?? ""))).toEqual({ url });
    expect(
      JSON.parse(decodeURIComponent(vscodeInstallLink(name, url).split("?")[1] ?? "")),
    ).toEqual({ name, type: "http", url });
    const claude = new URL(claudeInstallLink(name, url));
    expect(`${claude.origin}${claude.pathname}`).toBe("https://claude.ai/customize/connectors");
    expect(claude.searchParams.get("modal")).toBe("add-custom-connector");
    expect(claude.searchParams.get("connectorName")).toBe(name);
    expect(claude.searchParams.get("connectorUrl")).toBe(url);
    expect(JSON.parse(clientConfiguration("cursor", name, url))).toEqual({
      mcpServers: { [name]: { url } },
    });
    expect(JSON.parse(clientConfiguration("vscode", name, url))).toEqual({
      servers: { [name]: { type: "http", url } },
    });
    expect(clientConfiguration("codex", name, url)).toBe(`codex mcp add ${name} --url ${url}`);
    expect(clientConfiguration("claudeCode", name, url)).toBe(
      `claude mcp add --transport http ${name} ${url}`,
    );
    expect(clientConfiguration("gemini", name, url)).toBe(
      `gemini mcp add --transport http ${name} ${url}`,
    );
    expect(serverNameOf(address, "Team Skills")).toBe(name);
    expect(serverNameOf(address, String.fromCodePoint(0xd300))).toBe("skills");
  });

  it("shows installation then enabled tools in Cursor, with no unexpected manual editor", () => {
    const install = renderToStaticMarkup(
      <ConnectPreview
        client="cursor"
        step={0}
        name="my-skills"
        description="Skills for tests"
        url="https://skills.example/gh/acme/skills"
      />,
    );
    const enabled = renderToStaticMarkup(
      <ConnectPreview
        client="cursor"
        step={1}
        name="my-skills"
        description="Skills for tests"
        url="https://skills.example/gh/acme/skills"
      />,
    );
    expect(install).toContain(messagesFor("en").connect.preview.install);
    expect(install).toContain("https://skills.example/gh/acme/skills");
    expect(enabled).toContain(messagesFor("en").connect.preview.enabled);
    expect(enabled).toContain("read_repo_file");
    expect(enabled).not.toContain(".cursor/mcp.json");
  });
});
