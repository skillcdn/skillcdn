import { describe, expect, it } from "vitest";
import SCRIPT from "../../public/boot.js?raw";
import { LANGUAGE_PENDING_ATTRIBUTE, LANGUAGE_STORAGE_KEY, LANGUAGES } from "./languages.js";

// public/boot.js runs before any bundle, so it is plain JavaScript with its own copy of the
// language list and the rule. Run it against a pretend browser and hold it to the rule here.

function boot(options: {
  readonly href: string;
  readonly stored?: string;
  readonly browser?: readonly string[];
  /** Storage that throws, as a private window or a blocking policy makes it. */
  readonly blocked?: boolean;
}) {
  const store = new Map<string, string>();
  if (options.stored !== undefined) {
    store.set(LANGUAGE_STORAGE_KEY, options.stored);
  }
  const attributes = new Set<string>();
  const html = {
    lang: "en",
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  const blocked = () => {
    throw new Error("storage is blocked");
  };
  const storage =
    options.blocked === true
      ? { getItem: blocked, setItem: blocked }
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
        };
  // The script is one statement: run it as the body of a function whose parameters stand in
  // for the browser's globals.
  const run = new Function(
    "location",
    "localStorage",
    "navigator",
    "document",
    "setTimeout",
    SCRIPT,
  );
  run(
    { href: options.href },
    storage,
    { languages: options.browser ?? ["en-US"] },
    { documentElement: html },
    () => 0,
  );
  return {
    stored: store.get(LANGUAGE_STORAGE_KEY),
    lang: html.lang,
    pending: attributes.has(LANGUAGE_PENDING_ATTRIBUTE),
  };
}

describe("the boot script", () => {
  it("carries the language list, the storage key and the attribute of languages.ts", () => {
    expect(SCRIPT).toContain(JSON.stringify(LANGUAGES).replaceAll(",", ", "));
    expect(SCRIPT).toContain(`"${LANGUAGE_STORAGE_KEY}"`);
    expect(SCRIPT).toContain(`"${LANGUAGE_PENDING_ATTRIBUTE}"`);
  });

  it("makes a language the URL forces the preference, and leaves the page as served", () => {
    // The server already answered in that language, so nothing is hidden or changed.
    expect(boot({ href: "https://x.test/gh/acme/skills?lang=ko", stored: "en" })).toEqual({
      stored: "ko",
      lang: "en",
      pending: false,
    });
  });

  it("shows a URL without a language in the stored choice, else the browser's", () => {
    expect(boot({ href: "https://x.test/", stored: "ko" })).toMatchObject({
      lang: "ko",
      pending: true,
    });
    expect(boot({ href: "https://x.test/", browser: ["ko-KR", "en"] })).toMatchObject({
      lang: "ko",
      pending: true,
    });
    expect(boot({ href: "https://x.test/", browser: ["fr", "en-US"] })).toMatchObject({
      lang: "en",
      pending: false,
    });
  });

  it("ignores a language it does not have, and keeps the stored choice", () => {
    expect(boot({ href: "https://x.test/?lang=fr", stored: "ko" })).toEqual({
      stored: "ko",
      lang: "ko",
      pending: true,
    });
  });

  it("works without storage", () => {
    expect(boot({ href: "https://x.test/?lang=ko", blocked: true })).toMatchObject({
      lang: "en",
      pending: false,
    });
    expect(boot({ href: "https://x.test/", blocked: true, browser: ["ko"] })).toMatchObject({
      lang: "ko",
      pending: true,
    });
  });
});
