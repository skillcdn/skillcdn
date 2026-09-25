import { createDatabase } from "@skillcdn/db";
import type { Config } from "../config/config.js";
import { purgeByAddress } from "../http/admin.js";
import type { Logger } from "../logger.js";
import { OperatorListError } from "../operator/lists.js";
import { SERVER_NAME } from "../version.js";

/**
 * The `purge` role: removes what was indexed for one repository, given as `/gh/owner/repo`, and
 * exits. The same removal the admin API offers, for an operator with a shell and the database.
 * Exit codes: 0 done, 1 the repository was never indexed, 64 the argument is not a repository.
 */
export async function runPurge(config: Config, logger: Logger, address: string): Promise<number> {
  const database = createDatabase({
    connectionString: config.database.url,
    maxConnections: 2,
    applicationName: `${SERVER_NAME}-purge`,
  });
  try {
    const result = await purgeByAddress(database)(address);
    if (result === undefined) {
      logger.warn({ address }, "the repository was never indexed");
      return 1;
    }
    logger.info({ address, ...result }, "repository purged");
    return 0;
  } catch (error) {
    if (error instanceof OperatorListError) {
      logger.error({ address, reason: error.message }, "not a repository address");
      return 64;
    }
    throw error;
  } finally {
    await database.close();
  }
}
