import type { AddressHost, EmbedLimits, Entitlements, HostRepository } from "@skillcdn/core";
import type { EmbeddingScope } from "../config/config.js";

// What may be embedded (ADR-0064, point 4): the scope the deployment configured decides which
// repositories at all, and the `Entitlements` port decides for each, with the bounds it names.
// Both the api, before it queues, and the worker, before it embeds, ask the same question.

/** Whether repositories of this visibility are embedded under the scope. */
export function withinScope(scope: EmbeddingScope, visibility: "public" | "private"): boolean {
  return scope === "all" || (scope === "public" && visibility === "public");
}

export interface EmbedPolicy {
  readonly scope: EmbeddingScope;
  readonly entitlements: Entitlements;
}

export type EmbedDecision =
  | { readonly allowed: true; readonly limits: Partial<EmbedLimits> }
  | {
      readonly allowed: false;
      /** `scope`: the deployment does not embed repositories like this one. `refused`: the entitlements said no. */
      readonly reason: "scope" | "refused";
    };

/** Whether a repository may be embedded, and within which bounds. */
export async function decideEmbedding(
  policy: EmbedPolicy,
  host: AddressHost,
  repository: HostRepository,
): Promise<EmbedDecision> {
  if (!withinScope(policy.scope, repository.visibility)) {
    return { allowed: false, reason: "scope" };
  }
  const decision = await policy.entitlements.check({
    action: "embed",
    account: repository.owner,
    repository: {
      hostRepoId: repository.hostRepoId,
      visibility: repository.visibility,
      host,
      owner: repository.owner.login,
      name: repository.name,
    },
  });
  return decision.allowed
    ? { allowed: true, limits: decision.embed ?? {} }
    : { allowed: false, reason: "refused" };
}
