import process from "node:process";
import { ConfigError, loadConfig } from "./config/config.js";
import { createLogger } from "./logger.js";
import { parseRole, ROLES, type Role } from "./roles.js";

// Exit codes: 64 usage error, 78 invalid configuration, 70 internal failure.

async function run(role: Role): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 78;
      return;
    }
    throw error;
  }
  const logger = createLogger({ level: config.logLevel, role });

  try {
    // Each role loads its own dependency graph, so `migrate` does not pay for the HTTP stack.
    if (role === "api") {
      const { runApi } = await import("./roles/api.js");
      await runApi(config, logger);
    } else if (role === "migrate") {
      const { runMigrate } = await import("./roles/migrate.js");
      await runMigrate(config, logger);
    } else {
      logger.fatal({ role }, "this role is not implemented yet");
      process.exitCode = 70;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      // Settings that only a role can check, such as a directory it is pointed at.
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 78;
      return;
    }
    logger.fatal({ err: error }, "fatal error");
    process.exitCode = 70;
  }
}

const role = parseRole(process.argv[2]);
if (role === undefined) {
  process.stderr.write(`usage: node dist/main.js <${ROLES.join("|")}>\n`);
  process.exitCode = 64;
} else {
  await run(role);
}
