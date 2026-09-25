import { allowEverything, type Entitlements, parseAddress } from "@skillcdn/core";
import { repositoryKey } from "../mounts/mount-service.js";
import type { OperatorLists } from "./lists.js";

/**
 * The default implementation of the entitlements port (ADR-0026): the operator's deny list, in
 * front of whatever else decides. A blocked repository is refused as one that does not exist, so
 * that the answer gives nothing away. Everything else is `inner`'s to decide.
 */
export function createOperatorEntitlements(
  lists: Pick<OperatorLists, "isBlocked">,
  inner: Entitlements = allowEverything,
): Entitlements {
  return {
    async check(query) {
      const { host, owner, name } = query.repository;
      const parsed = parseAddress(`/${host}/${owner}/${name}`);
      if (parsed.ok && (await lists.isBlocked(repositoryKey(parsed.value)))) {
        return { allowed: false, reason: "The repository was not found.", hidden: true };
      }
      return inner.check(query);
    },
  };
}
