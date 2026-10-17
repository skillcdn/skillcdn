import type { Address, RestMount, RestSkill } from "@skillcdn/core";
import { ApiError, type SkillCdnClient } from "./client.js";

// What a program reads of a pack beyond one request: the index, waited for while a first look
// at a commit indexes it, and a skill whole, page after page until it is complete.

/** A ready `skills` answer: one page of a skill. */
export type SkillPage = Extract<RestSkill, { status: "ready" }>;

export interface WaitOptions {
  readonly signal?: AbortSignal | undefined;
  /** How long to wait for an index that is being built; the deployment indexes a commit in seconds. */
  readonly timeoutMs?: number | undefined;
  /** How long between two looks. */
  readonly intervalMs?: number | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

const DEFAULT_WAIT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The `mounts` answer of an address once its index is ready, asking again while it is being
 * built. An index that failed, or that is not ready in time, is an `ApiError` with the code the
 * API gives the state (`index.failed`, `index.indexing`).
 */
export async function whenIndexed(
  client: SkillCdnClient,
  address: Address,
  options: WaitOptions = {},
): Promise<RestMount> {
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_MS);
  for (;;) {
    const mount = await client.mount(address, options.signal);
    if (mount.index.status === "ready") {
      return mount;
    }
    if (mount.index.status === "failed") {
      throw new ApiError(
        503,
        "index.failed",
        `The repository could not be indexed (${mount.index.errorCode}). Try again later.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new ApiError(
        503,
        "index.indexing",
        "The repository is being indexed. Try again shortly.",
      );
    }
    await sleep(options.intervalMs ?? DEFAULT_INTERVAL_MS);
  }
}

/** How many pages of one skill are followed before the read stops: far above what one holds. */
export const MAX_SKILL_PAGES = 256;

/**
 * Every page of a skill's context, read with the cursor each page gives, until the skill is
 * complete or a page gives no cursor. An answer that is not ready is an `ApiError`.
 */
export async function skillPages(
  client: SkillCdnClient,
  address: Address,
  path: string,
  options: { readonly signal?: AbortSignal | undefined } = {},
): Promise<SkillPage[]> {
  const pages: SkillPage[] = [];
  let cursor: string | undefined;
  while (pages.length < MAX_SKILL_PAGES) {
    const page = await client.skill(address, { path, cursor }, options.signal);
    if (page.status !== "ready") {
      throw new ApiError(
        503,
        page.status === "indexing" ? "index.indexing" : "index.failed",
        page.status === "indexing"
          ? "The repository is being indexed. Try again shortly."
          : `The repository could not be indexed (${page.errorCode}). Try again later.`,
      );
    }
    pages.push(page);
    cursor = page.skill.nextCursor ?? undefined;
    if (page.skill.complete === true || cursor === undefined) {
      return pages;
    }
  }
  throw new ApiError(0, "invalid_response", "The skill did not complete within the pages read.");
}
