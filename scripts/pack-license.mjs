// Each published package carries the repository's license (ADR-0046) while the text has one
// source: `prepack` copies LICENSE.md next to what is packed, and `postpack` takes the copy out
// again. The brand package names TRADEMARKS.md instead, the terms its files are under (ADR-0048).
// Package scripts run in the package's directory, two levels below the root.
import { copyFileSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";

const action = process.argv[2];
const file = process.argv[3] ?? "LICENSE.md";
if (basename(file) !== file || (action !== "copy" && action !== "remove")) {
  process.stderr.write(
    "usage: node ../../scripts/pack-license.mjs copy|remove [a file at the repository root]\n",
  );
  process.exit(64);
}
if (action === "copy") {
  copyFileSync(resolve("..", "..", file), file);
} else {
  rmSync(file, { force: true });
}
