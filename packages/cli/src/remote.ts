import {
  ApiError,
  createClient,
  type FetchLike,
  type SkillCdnClient,
  whenIndexed,
} from "@skillcdn/client";
import type { Address } from "@skillcdn/core";
import { type Pack, PackError } from "./pack.js";

// A pack at a deployment (ADR-0056): the five reads of its REST API through @skillcdn/client,
// with the token a person made for it as the bearer, waiting while a first look at a commit
// indexes it. What the API refuses is a PackError with the API's own code.

export interface RemoteOptions {
  readonly url: string;
  readonly address: Address;
  readonly token: string | undefined;
  readonly fetch: FetchLike;
  readonly userAgent: string | undefined;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long a read waits for an index that is being built. */
  readonly waitMs?: number | undefined;
}

/** How long a read waits for the deployment to index a commit it sees for the first time. */
export const DEFAULT_WAIT_MS = 30_000;

const asPackError = (error: unknown): never => {
  if (error instanceof ApiError) {
    throw new PackError(error.status, error.code, error.message, {
      directories: error.directories,
      sourceUrl: error.sourceUrl,
    });
  }
  throw error;
};

export function openDeployment(options: RemoteOptions): Pack {
  const client: SkillCdnClient = createClient({
    baseUrl: options.url,
    fetch: options.fetch,
    token: options.token,
    userAgent: options.userAgent,
  });
  const { address } = options;
  const wait = { timeoutMs: options.waitMs ?? DEFAULT_WAIT_MS, sleep: options.sleep };
  /** The index is there to read from, or the deployment says why not. */
  const indexed = async (): Promise<void> => {
    await whenIndexed(client, address, wait).catch(asPackError);
  };
  const notReady = (status: "indexing" | "failed", errorCode?: string): never => {
    throw new PackError(
      503,
      status === "indexing" ? "index.indexing" : "index.failed",
      status === "indexing"
        ? "The repository is being indexed. Try again shortly."
        : `The repository could not be indexed (${errorCode ?? "unknown"}). Try again later.`,
    );
  };
  return {
    address,
    source: { kind: "deployment", url: options.url },
    async mount() {
      return whenIndexed(client, address, wait).catch(asPackError);
    },
    async browse(query) {
      await indexed();
      const body = await client.browse(address, query).catch(asPackError);
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async find(query) {
      await indexed();
      const body = await client.find(address, query).catch(asPackError);
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async skill(path, cursor) {
      await indexed();
      const body = await client.skill(address, { path, cursor }).catch(asPackError);
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async file(query) {
      await indexed();
      return client.file(address, query).catch(asPackError);
    },
  };
}
