// Each published package carries the repository's license (ADR-0045) while the text has one
// source: `prepack` copies LICENSE.md next to what is packed, and `postpack` takes the copy out
// again. Package scripts run in the package's directory, two levels below the root.
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const LICENSE = "LICENSE.md";
const action = process.argv[2];
if (action === "copy") {
  copyFileSync(resolve("..", "..", LICENSE), LICENSE);
} else if (action === "remove") {
  rmSync(LICENSE, { force: true });
} else {
  process.stderr.write("usage: node ../../scripts/pack-license.mjs copy|remove\n");
  process.exit(64);
}
