import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { imageVersion } from "./image-version.js";

// Run by the build of the image, from the root of the checkout it builds (deploy/Dockerfile):
// prints what the server of the image says of itself (ADR-0134). Its one argument is the version
// the build names, empty when it names none.

const root = process.cwd();
const result = imageVersion(process.argv[2], (path) => {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
});
if (result.ok) {
  process.stdout.write(`${result.version}\n`);
} else {
  process.stderr.write(`${result.problem}\n`);
  process.exitCode = 1;
}
