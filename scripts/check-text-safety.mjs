// Fails when a tracked text file contains a control character or an invisible one (zero-width,
// bidirectional override, byte order mark). Such characters make source read differently from
// what it does, and tools that write files sometimes decode an escape sequence into one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BINARY = /\.(png|jpe?g|gif|ico|webp|pdf|woff2?|ttf|zip|gz|tgz)$/i;

function isForbidden(codePoint) {
  return (
    (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file.length > 0 && !BINARY.test(file));

const findings = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const character of line) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (isForbidden(codePoint)) {
        const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
        findings.push(`${file}:${index + 1}: U+${hex}`);
      }
    }
  });
}

if (findings.length > 0) {
  process.stderr.write(`control or invisible characters found:\n  ${findings.join("\n  ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`text safety: ${files.length} files clean\n`);
}
