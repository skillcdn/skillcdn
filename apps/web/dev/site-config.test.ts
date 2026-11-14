import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SITE_CONFIG_MODULE,
  SITE_PUBLIC_MODULE,
  siteConfig,
  siteConfigFile,
} from "./site-config.js";

// Which file a build is configured by (ADR-0099), and what the two names of the configuration
// resolve to: the file, and the module a configuration is written with.

/** What the plugin resolves a name to, called as the bundler calls it. */
function resolved(named: string | undefined, id: string): unknown {
  const hook = siteConfig(named).resolveId;
  const call = typeof hook === "function" ? hook : hook?.handler;
  return (call as ((this: unknown, id: string) => unknown) | undefined)?.call({}, id);
}

describe("the configuration of a build", () => {
  it("is the product's own unless a file is named, and a named file is found from where the build started", () => {
    const own = siteConfigFile(undefined, "/somewhere");
    expect(isAbsolute(own)).toBe(true);
    expect(existsSync(own)).toBe(true);
    expect(own.replaceAll("\\", "/")).toMatch(/\/src\/site-config\.default\.ts$/);
    expect(siteConfigFile("", "/somewhere")).toBe(own);
    expect(siteConfigFile("  ", "/somewhere")).toBe(own);
    const cwd = resolve("examples");
    expect(siteConfigFile("site/site.config.tsx", cwd)).toBe(resolve(cwd, "site/site.config.tsx"));
    const absolute = resolve("examples/site/site.config.tsx");
    expect(siteConfigFile(absolute, "/elsewhere")).toBe(absolute);
  });

  it("resolves the configuration to the file, and what a configuration imports to the module that says what one is", () => {
    const example = resolve("examples/site/site.config.tsx");
    expect(resolved(example, SITE_CONFIG_MODULE)).toBe(example);
    expect(resolved(undefined, SITE_CONFIG_MODULE)).toBe(siteConfigFile(undefined, "/"));
    const module = resolved(example, SITE_PUBLIC_MODULE);
    expect(String(module).replaceAll("\\", "/")).toMatch(/\/src\/site-pages\.ts$/);
    expect(existsSync(String(module))).toBe(true);
    expect(resolved(example, "react")).toBeUndefined();
  });
});
