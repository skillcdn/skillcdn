import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type GitHostDelivery,
  GitHostDeliveryError,
  type GitHostEvent,
  type GitHostEventSource,
} from "@skillcdn/core";
import * as z from "zod";

export interface GitHubEventsOptions {
  /** The secret the app's webhook was given at the host. Never logged, never part of an error. */
  readonly secret: string;
}

/** The host signs the body with HMAC-SHA256 under the shared secret and sends the digest in hex. */
const SIGNATURE = /^sha256=([0-9a-f]{64})$/i;
/** What the host calls an event and an action. Anything else is not written to a log. */
const NAME = /^[a-z_]{1,64}$/;
/** The content type of a delivery that carries its JSON in a form field named `payload`. */
const FORM = /^application\/x-www-form-urlencoded\b/i;
/** The host's id of a delivery: a GUID. */
const DELIVERY_ID = /^[0-9a-f-]{1,64}$/i;

// Only the fields that are read are validated; the host adds fields freely. An id is the
// host's immutable number, kept as text like every other host id.
const hostId = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger)
  .transform((id) => String(id));
const action = z.string().optional();
const repositoryRef = z.object({ id: hostId });
const accountRef = z.object({ id: hostId });

const pushSchema = z.object({ repository: repositoryRef });
const repositorySchema = z.object({ action, repository: repositoryRef });
const installationSchema = z.object({
  action,
  // The host documents the account as one that may be missing, and the list as optional.
  installation: z.object({ account: accountRef.nullable().optional() }),
  repositories: z.array(repositoryRef).optional(),
});
const installationRepositoriesSchema = z.object({
  action,
  repositories_removed: z.array(repositoryRef).optional(),
});
const authorizationSchema = z.object({ action, sender: accountRef });
const collaboratorSchema = z.object({ action, repository: repositoryRef });
const teamSchema = z.object({
  action,
  organization: accountRef,
  repository: repositoryRef.nullable().optional(),
});
const organizationSchema = z.object({ action, organization: accountRef });

interface Read {
  /** The action the delivery names, for the log. */
  readonly action?: string | undefined;
  readonly events: readonly GitHostEvent[];
}

function parse<Schema extends z.ZodType>(schema: Schema, payload: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new GitHostDeliveryError("malformed", "the delivery lacks what its event is read by");
  }
  return parsed.data;
}

/**
 * What each event of the host ends here. An event without an entry ends nothing: the host
 * sends many that say nothing about who sees what or where a ref points.
 */
const READERS: Readonly<Record<string, (payload: unknown) => Read>> = {
  // A branch or a tag was pushed, created or deleted: `create` and `delete` say it again.
  push: refsChanged,
  create: refsChanged,
  delete: refsChanged,

  repository(payload) {
    const { action, repository } = parse(repositorySchema, payload);
    if (action === "created") {
      // Nothing was ever remembered about a repository that did not exist.
      return { action, events: [] };
    }
    return {
      action,
      events: [
        {
          kind: "repository_changed",
          hostRepoId: repository.id,
          closed: action === "privatized" ? "private" : action === "deleted" ? "gone" : undefined,
        },
      ],
    };
  },

  // An older way the host says that a repository was made public.
  public(payload) {
    const { repository } = parse(pushSchema, payload);
    return {
      events: [{ kind: "repository_changed", hostRepoId: repository.id, closed: undefined }],
    };
  },

  installation(payload) {
    const { action, installation, repositories } = parse(installationSchema, payload);
    // Everything of the account, or what the delivery lists when it names no account.
    const account = installation.account;
    const listed = (repositories ?? []).map((repository) => repository.id);
    const scope =
      account !== null && account !== undefined
        ? { hostAccountId: account.id }
        : listed.length > 0
          ? { hostRepoIds: listed }
          : undefined;
    if (scope === undefined) {
      return { action, events: [] };
    }
    if (action === "deleted") {
      return { action, events: [{ kind: "installation_removed", scope }] };
    }
    // Suspended, the app reads nothing until it is let back in: what it read stays, and nobody
    // is served it on an answer from before.
    return { action, events: action === "suspend" ? [{ kind: "access_changed", scope }] : [] };
  },

  installation_repositories(payload) {
    const { action, repositories_removed: removed } = parse(
      installationRepositoriesSchema,
      payload,
    );
    const hostRepoIds = (removed ?? []).map((repository) => repository.id);
    return {
      action,
      events:
        action === "removed" && hostRepoIds.length > 0
          ? [{ kind: "installation_removed", scope: { hostRepoIds } }]
          : [],
    };
  },

  github_app_authorization(payload) {
    const { action, sender } = parse(authorizationSchema, payload);
    return {
      action,
      events:
        action === "revoked" ? [{ kind: "authorization_revoked", hostAccountId: sender.id }] : [],
    };
  },

  // The events below are sent only to an app that may read an organization's members.
  member: collaboratorsChanged,
  team_add: collaboratorsChanged,

  team(payload) {
    const { action, organization, repository } = parse(teamSchema, payload);
    return {
      action,
      events: [
        {
          kind: "access_changed",
          scope:
            repository === null || repository === undefined
              ? { hostAccountId: organization.id }
              : { hostRepoIds: [repository.id] },
        },
      ],
    };
  },

  membership: membersChanged,
  organization: membersChanged,
};

function refsChanged(payload: unknown): Read {
  const { repository } = parse(pushSchema, payload);
  return { events: [{ kind: "refs_changed", hostRepoId: repository.id }] };
}

function collaboratorsChanged(payload: unknown): Read {
  const { action, repository } = parse(collaboratorSchema, payload);
  return {
    action,
    events: [{ kind: "access_changed", scope: { hostRepoIds: [repository.id] } }],
  };
}

function membersChanged(payload: unknown): Read {
  const { action, organization } = parse(organizationSchema, payload);
  return {
    action,
    events: [{ kind: "access_changed", scope: { hostAccountId: organization.id } }],
  };
}

/**
 * Reads the deliveries of a GitHub App's webhook. The signature is verified over the body as it
 * arrived, in constant time, before anything of the body is parsed; a delivery that fails is
 * refused whatever it says. The payload is read in either form the host sends one in: as the
 * JSON body, or as the `payload` field of a form.
 */
export function createGitHubEvents(options: GitHubEventsOptions): GitHostEventSource {
  const { secret } = options;
  return {
    host: "gh",

    read({ header, body }): GitHostDelivery {
      const presented = SIGNATURE.exec(header("x-hub-signature-256") ?? "")?.[1];
      const expected = createHmac("sha256", secret).update(body).digest();
      // Compared in full whatever was presented, so that a refusal takes the time an accepted
      // delivery takes.
      const given = Buffer.from(presented ?? "0".repeat(64), "hex");
      if (!timingSafeEqual(given, expected) || presented === undefined) {
        throw new GitHostDeliveryError("unsigned", "the delivery is not signed by the git host");
      }

      const name = header("x-github-event") ?? "";
      if (!NAME.test(name)) {
        throw new GitHostDeliveryError("malformed", "the delivery does not name its event");
      }
      const delivery = header("x-github-delivery");
      const id = delivery !== undefined && DELIVERY_ID.test(delivery) ? delivery : undefined;

      const reader = READERS[name];
      if (reader === undefined) {
        return { id, name, events: [] };
      }
      let payload: unknown;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
        const form = FORM.test(header("content-type") ?? "");
        payload = JSON.parse(form ? (new URLSearchParams(text).get("payload") ?? "") : text);
      } catch (error) {
        throw new GitHostDeliveryError("malformed", "the delivery is not JSON", { cause: error });
      }
      const read = reader(payload);
      return {
        id,
        name: read.action !== undefined && NAME.test(read.action) ? `${name}.${read.action}` : name,
        events: read.events,
      };
    },
  };
}
