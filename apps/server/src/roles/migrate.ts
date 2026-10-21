import { migrateDatabase } from "@skillcdn/db";
import type { Config } from "../config/config.js";
import type { Logger } from "../logger.js";

/** Applies pending migrations, then exits. Run once, before a new version rolls out. */
export async function runMigrate(config: Config, logger: Logger): Promise<void> {
  const { latest, notices } = await migrateDatabase(config.database.url);
  for (const notice of notices) {
    logger.warn({ notice }, "the database said");
  }
  logger.info({ latest }, "migrations applied");
}
