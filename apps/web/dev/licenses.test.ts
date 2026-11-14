import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledPackages, noticeOf } from "./licenses.js";

// What the notice of the pages lists: the packages the modules of the bundle are files of, read
// from where the build found them, whichever way the packages were laid out.

let root: string | undefined;

function tree(files: Readonly<Record<string, string>>): string {
  root = mkdtempSync(join(tmpdir(), "skillcdn-licenses-"));
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root.replaceAll("\\", "/");
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const manifest = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe("the packages of a bundle", () => {
  it("names each package a module is a file of once, with its license and the text it ships", () => {
    const at = tree({
      "node_modules/plain/package.json": manifest({
        name: "plain",
        version: "1.0.0",
        license: "MIT",
      }),
      "node_modules/plain/LICENSE": "The plain license.",
      "node_modules/plain/index.js": "",
      "node_modules/plain/lib/more.js": "",
      // A package.json that says how the files beside it are read is not a package.
      "node_modules/plain/esm/package.json": manifest({ type: "module" }),
      "node_modules/plain/esm/index.js": "",
      "node_modules/@scope/named/package.json": manifest({
        name: "@scope/named",
        version: "2.1.0",
        license: { type: "ISC" },
        homepage: "https://named.example",
      }),
      "node_modules/@scope/named/license.md": "The named license.",
      "node_modules/@scope/named/dist/index.js": "",
      // Laid out as pnpm does, a version in its own store directory.
      "node_modules/.pnpm/deep@3.0.0/node_modules/deep/package.json": manifest({
        name: "deep",
        version: "3.0.0",
        license: "Apache-2.0",
      }),
      "node_modules/.pnpm/deep@3.0.0/node_modules/deep/index.js": "",
      // A package of this repository carries the repository's license, and is not listed.
      "node_modules/@skillcdn/core/package.json": manifest({
        name: "@skillcdn/core",
        version: "0.5.0",
        license: "FSL-1.1-ALv2",
      }),
      "node_modules/@skillcdn/core/dist/index.js": "",
      "src/app.tsx": "",
    });
    const packages = bundledPackages([
      `${at}/node_modules/plain/index.js`,
      `${at}/node_modules/plain/lib/more.js?commonjs-exports`,
      `\0${at}/node_modules/plain/esm/index.js`,
      `${at}/node_modules/@scope/named/dist/index.js`,
      `${at}/node_modules/.pnpm/deep@3.0.0/node_modules/deep/index.js`,
      `${at}/node_modules/@skillcdn/core/dist/index.js`,
      `${at}/src/app.tsx`,
      "\0vite/preload-helper.js",
    ]);
    expect(packages).toEqual([
      {
        name: "@scope/named",
        version: "2.1.0",
        license: "ISC",
        homepage: "https://named.example",
        text: "The named license.",
      },
      {
        name: "deep",
        version: "3.0.0",
        license: "Apache-2.0",
        homepage: undefined,
        text: undefined,
      },
      {
        name: "plain",
        version: "1.0.0",
        license: "MIT",
        homepage: undefined,
        text: "The plain license.",
      },
    ]);
    const notice = noticeOf(packages);
    expect(notice).toContain("3 packages.");
    expect(notice).toContain("plain 1.0.0\nLicense: MIT\n\nThe plain license.");
    expect(notice).toContain(
      "deep 3.0.0\nLicense: Apache-2.0\n\n(The package ships no license file;",
    );
    expect(notice).not.toContain("@skillcdn/core");
  });
});
