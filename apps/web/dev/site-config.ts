import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, searchForWorkspaceRoot } from "vite";

// The configuration of the build (ADR-0099): `virtual:skillcdn-site` is the file an installation
// names in `SKILLCDN_WEB_CONFIG`, or the product's own, which adds nothing. The file may stand
// anywhere, with the components and the styles of its pages beside it: what it imports of the
// packages the pages are built with is resolved from this workspace, so that a directory of an
// installation needs no dependencies of its own, and `@skillcdn/web` is the module that says
// what a configuration is (`src/site-pages.ts`).

const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = resolve(WORKSPACE, "src/site-config.default.ts");
const PUBLIC_MODULE = resolve(WORKSPACE, "src/site-pages.ts");

/** The module a configuration is read from in the pages. */
export const SITE_CONFIG_MODULE = "virtual:skillcdn-site";
/** The name a configuration imports what it is written with by. */
export const SITE_PUBLIC_MODULE = "@skillcdn/web";

/** The file a build is configured by: the one named, from where the build was started, or the default. */
export function siteConfigFile(named: string | undefined, cwd: string): string {
  if (named === undefined || named.trim().length === 0) {
    return DEFAULT_CONFIG;
  }
  return isAbsolute(named) ? named : resolve(cwd, named);
}

export function siteConfig(named: string | undefined): Plugin {
  const file = siteConfigFile(named, process.cwd());
  return {
    name: "skillcdn-site-config",
    enforce: "pre",
    config() {
      return {
        resolve: {
          // One copy of what the pages are made with, whichever directory a page is in.
          dedupe: ["react", "react-dom", "@skillcdn/client", "@skillcdn/core"],
        },
        ...(file === DEFAULT_CONFIG
          ? {}
          : {
              server: {
                fs: { allow: [searchForWorkspaceRoot(WORKSPACE), dirname(file)] },
              },
            }),
      };
    },
    buildStart() {
      if (!existsSync(file)) {
        this.error(`SKILLCDN_WEB_CONFIG names a file that is not there: ${file}`);
      }
    },
    resolveId(id) {
      if (id === SITE_CONFIG_MODULE) {
        return file;
      }
      if (id === SITE_PUBLIC_MODULE) {
        return PUBLIC_MODULE;
      }
      return undefined;
    },
  };
}
