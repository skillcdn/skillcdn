import process from "node:process";
import { ConfigError, loadConfig, loadIndexLimits } from "./config/config.js";
import { createLogger } from "./logger.js";
import { parseRole, ROLES, type Role } from "./roles.js";

// Exit codes: 64 usage error, 78 invalid configuration, 70 internal failure. `check` exits with
// 1 when the directory it read has a manifest that cannot be read, and 2 when it cannot be read.

function reportConfigError(error: unknown): boolean {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 78;
    return true;
  }
  return false;
}

async function run(role: Exclude<Role, "check">, argument: string | undefined): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (reportConfigError(error)) {
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
    } else if (role === "purge") {
      if (argument === undefined) {
        process.stderr.write("usage: node dist/main.js purge /gh/owner/repo\n");
        process.exitCode = 64;
        return;
      }
      const { runPurge } = await import("./roles/purge.js");
      process.exitCode = await runPurge(config, logger, argument);
    } else {
      logger.fatal({ role }, "this role is not implemented yet");
      process.exitCode = 70;
    }
  } catch (error) {
    // Settings that only a role can check, such as a directory it is pointed at.
    if (reportConfigError(error)) {
      return;
    }
    logger.fatal({ err: error }, "fatal error");
    process.exitCode = 70;
  }
}

/**
 * Reads a directory as the indexer would and reports what an agent would get: a tool for
 * repository authors that needs neither a database nor a git host, so it takes only the
 * indexing limits from the environment.
 */
async function runCheck(directory: string): Promise<void> {
  try {
    const limits = loadIndexLimits();
    const { checkDirectory } = await import("./roles/check.js");
    process.exitCode = await checkDirectory({
      directory,
      limits,
      write: (text) => {
        process.stdout.write(text);
      },
    });
  } catch (error) {
    if (reportConfigError(error)) {
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 70;
  }
}

const role = parseRole(process.argv[2]);
if (role === undefined) {
  process.stderr.write(
    `usage: node dist/main.js <${ROLES.join("|")}>\n       node dist/main.js check [directory]\n       node dist/main.js purge /gh/owner/repo\n`,
  );
  process.exitCode = 64;
} else if (role === "check") {
  await runCheck(process.argv[3] ?? ".");
} else {
  await run(role, process.argv[3]);
}
