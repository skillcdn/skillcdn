import process from "node:process";
import { createDatabase, createJobQueue } from "@skillcdn/db";
import { connectGitHub, createGitHubHost, type GitHubHostOptions } from "@skillcdn/github";
import { createEmbedderOf } from "../adapters/meaning.js";
import { systemClock } from "../adapters/system-clock.js";
import type { Config } from "../config/config.js";
import { createWorker } from "../jobs/worker.js";
import type { Logger } from "../logger.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

/**
 * The composition root of the `worker` role (ADR-0064): runs the jobs of the queue until told to
 * stop. Indexes repositories on request; where an embedder is configured, embeds the sections of
 * indexed commits and sweeps for what is served and not yet embedded. Resolves when the process
 * has shut down cleanly.
 */
export async function runWorker(config: Config, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    maxConnections: config.database.poolMax,
    applicationName: `${SERVER_NAME}-worker`,
  });
  const jobs = await createJobQueue(database, {
    role: "worker",
    onError: (error) => logger.error({ err: error }, "the job queue failed"),
    onWarning: (message) => logger.warn({ message }, "the job queue warns"),
  });

  // The same connection to the git host the api role reads repositories with.
  const github: GitHubHostOptions = {
    baseUrl: config.github.apiUrl,
    userAgent: `${SERVER_NAME}/${SERVER_VERSION}`,
    token: async () => config.github.token,
    ...(config.auth === undefined
      ? {}
      : {
          app: { appId: config.auth.github.appId, privateKey: config.auth.github.privateKey },
        }),
  };
  const gitHost = createGitHubHost(github, connectGitHub(github));
  const embedder =
    config.meaning.embeddings === undefined
      ? undefined
      : createEmbedderOf(config.meaning.embeddings);

  const worker = createWorker(
    {
      mounts: config.mounts,
      indexing: config.indexing,
      embedConcurrency: config.meaning.embeddings?.concurrency ?? 1,
    },
    { database, jobs, gitHost, embedder, clock: systemClock, logger },
  );
  const { queues } = await worker.start();
  logger.info({ queues, model: embedder?.model }, "worker started");

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      logger.info({ signal }, "shutting down");
      resolve();
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  });
  // Running jobs get the grace period; unfinished indexing is handed back to the database.
  await worker.close(config.http.shutdownGraceMs);
  await database.close();
  logger.info("shutdown complete");
}
