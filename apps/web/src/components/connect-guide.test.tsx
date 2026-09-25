import { parseAddress } from "@skillcdn/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nContext, messagesFor } from "../i18n/index.js";
import { CLIENT_DETAILS, CONNECT_CLIENTS, clientConfiguration } from "./connect-clients.js";
import {
  ConnectGuide,
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

  it("offers the complete name and address as copy targets inside the form", () => {
    const scene = renderToStaticMarkup(
      <ConnectPreview
        client="claude"
        step={1}
        name="team-skills"
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
        <ConnectPreview client={client} step={1} name="my-skills" url="https://skills.example" />,
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
    expect(JSON.parse(clientConfiguration("cursor", name, url))).toEqual({
      mcpServers: { [name]: { url } },
    });
    expect(JSON.parse(clientConfiguration("vscode", name, url))).toEqual({
      servers: { [name]: { type: "http", url } },
    });
    expect(JSON.parse(clientConfiguration("windsurf", name, url))).toEqual({
      mcpServers: { [name]: { serverUrl: url } },
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
        url="https://skills.example/gh/acme/skills"
      />,
    );
    const enabled = renderToStaticMarkup(
      <ConnectPreview
        client="cursor"
        step={1}
        name="my-skills"
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
