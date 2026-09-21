import process from "node:process";
import { parseRole, ROLES } from "./roles.js";

const role = parseRole(process.argv[2]);

if (role === undefined) {
  process.stderr.write(`usage: node dist/main.js <${ROLES.join("|")}>\n`);
  process.exitCode = 64;
} else {
  // Roles are wired in as they are implemented; see docs/roadmap.md.
  process.stderr.write(`role "${role}" is not implemented yet\n`);
  process.exitCode = 70;
}
