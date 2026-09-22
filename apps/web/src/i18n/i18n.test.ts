import { describe, expect, it } from "vitest";
import { messagesFor } from "./index.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  languageInSearch,
  languageOfSearch,
  preferredLanguage,
  resolveLanguage,
  withForcedLanguage,
  withLanguage,
} from "./languages.js";

/** Every leaf of a pack as `path -> type`, so that packs can be compared whatever they say. */
function shapeOf(value: unknown, path = ""): Record<string, string> {
  if (typeof value === "object" && value !== null) {
    return Object.assign(
      {},
      ...Object.entries(value).map(([key, child]) =>
        shapeOf(child, path === "" ? key : `${path}.${key}`),
      ),
    );
  }
  return { [path]: typeof value };
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(stringsOf) : [];
}

describe("language packs", () => {
  it("all have the shape of the default pack, list lengths included", () => {
    const reference = shapeOf(messagesFor(DEFAULT_LANGUAGE));
    for (const language of LANGUAGES) {
      expect(shapeOf(messagesFor(language)), language).toEqual(reference);
    }
  });

  it("leave nothing empty and nothing untranslated by accident", () => {
    for (const language of LANGUAGES) {
      for (const text of stringsOf(messagesFor(language))) {
        expect(text.trim().length, `${language}: an empty message`).toBeGreaterThan(0);
      }
    }
    // Names of products stay as they are in every language.
    const names = new Set(["Claude Code", "VS Code", "Codex CLI", "Gemini CLI"]);
    const english = new Set(
      stringsOf(messagesFor("en")).filter((text) => text.includes(" ") && !names.has(text)),
    );
    const copied = stringsOf(messagesFor("ko")).filter((text) => english.has(text));
    expect(copied).toEqual([]);
  });

  it("fill in what messages with arguments are given", () => {
    for (const language of LANGUAGES) {
      const t = messagesFor(language);
      expect(t.meta.mount.title("acme/skills")).toContain("acme/skills");
      expect(t.mount.tabs.skills(12)).toContain("12");
      expect(t.mount.listLimited(200, 230)).toMatch(/200.*230|230.*200/);
      expect(t.mount.search.resultsFor("review")).toContain("review");
      expect(t.file.showing(0, 40_000, 120_000)).toMatch(/40[,.]?000/);
    }
  });
});

describe("the language of a URL", () => {
  it("is the default unless the parameter names a language we have", () => {
    expect(languageOfSearch("")).toBe("en");
    expect(languageOfSearch("?lang=ko")).toBe("ko");
    expect(languageOfSearch("?q=x&lang=ko")).toBe("ko");
    expect(languageOfSearch("?lang=KO")).toBe("en");
    expect(languageOfSearch("?lang=fr")).toBe("en");
    expect(languageOfSearch("?lang=")).toBe("en");
  });

  it("is forced only when the parameter names a language we have", () => {
    expect(languageInSearch("")).toBeUndefined();
    expect(languageInSearch("?lang=fr")).toBeUndefined();
    expect(languageInSearch("?lang=ko")).toBe("ko");
  });

  it("gives every page exactly one URL per language", () => {
    expect(withLanguage("/", "en")).toBe("/");
    expect(withLanguage("/", "ko")).toBe("/?lang=ko");
    expect(withLanguage("/?lang=ko", "en")).toBe("/");
    expect(withLanguage("/explore?lang=ko", "ko")).toBe("/explore?lang=ko");
    expect(withLanguage("/gh/acme/skills@release/1.2:docs?file=a%20b.md#top", "ko")).toBe(
      "/gh/acme/skills@release/1.2:docs?file=a+b.md&lang=ko#top",
    );
  });
});

describe("a forced language", () => {
  it("is carried on even when it is the default", () => {
    expect(withForcedLanguage("/explore", "en")).toBe("/explore?lang=en");
    expect(withForcedLanguage("/explore?lang=ko", "en")).toBe("/explore?lang=en");
    expect(withForcedLanguage("/gh/acme/skills?file=a.md#top", "ko")).toBe(
      "/gh/acme/skills?file=a.md&lang=ko#top",
    );
  });
});

describe("the language a page is shown in", () => {
  it("is the one the URL forces, else the visitor's preference, else the default", () => {
    expect(resolveLanguage("?lang=ko", "en")).toEqual({ language: "ko", forced: true });
    expect(resolveLanguage("?lang=en", "ko")).toEqual({ language: "en", forced: true });
    expect(resolveLanguage("?q=x", "ko")).toEqual({ language: "ko", forced: false });
    expect(resolveLanguage("?lang=fr", "ko")).toEqual({ language: "ko", forced: false });
    expect(resolveLanguage("", undefined)).toEqual({ language: "en", forced: false });
    expect(resolveLanguage("")).toEqual({ language: DEFAULT_LANGUAGE, forced: false });
  });
});

describe("the language of a visitor who did not say", () => {
  it("is what they chose before, else what their browser reads first", () => {
    expect(preferredLanguage("ko", ["en-US"])).toBe("ko");
    expect(preferredLanguage("en", ["ko-KR"])).toBe("en");
    expect(preferredLanguage(null, ["ko-KR", "en-US"])).toBe("ko");
    expect(preferredLanguage(null, ["fr-FR", "ko"])).toBe("ko");
    expect(preferredLanguage(null, ["fr-FR", "de"])).toBe("en");
    expect(preferredLanguage("klingon", [])).toBe("en");
  });
});
