// The mini build of zod, as in contracts.ts: these schemas also run in the browser.
import * as z from "zod/mini";
import { formatOwnerPath, GIT_HOST_KEYS, type OwnerPath } from "../address.js";
import { REST_ROUTES, restRepositoryCardSchema } from "./contracts.js";

// People (docs/specs/permissions.md): signing in through the git host, what a signed-in person
// has here, the page of an account, and the consent a client asks a person for. Contract:
// docs/specs/rest.md. Absent values are `null` on the wire, never missing keys.

/** Where a browser signs in and out. These are navigations and one form post, not the REST API. */
export const AUTH_ROUTES = {
  /** Sends the browser to the git host to sign in, and afterwards to `return_to`. */
  login: "/auth/gh/login",
  /** Where the git host sends the browser back to. */
  callback: "/auth/gh/callback",
  /** A POST from the pages that ends the session. */
  logout: "/auth/logout",
} as const;

/**
 * The parameter naming the page to come back to, signed in: a path of this origin. The login
 * route takes it, and so does the sign-in page, which hands it on.
 */
export const RETURN_TO_PARAM = "return_to";

/**
 * The page where a person chooses to sign in, before their browser leaves for the git host
 * (ADR-0041). Everything that offers signing in leads here or shows what this page shows.
 */
export const SIGN_IN_PAGE_PATH = "/login";
/** Why a sign-in did not complete, as the sign-in page is told in its query. */
export const SIGN_IN_ERROR_PARAM = "error";
/**
 * What that parameter says: the person said no at the git host, the attempt was not finished in
 * time or in the browser that began it, or the host did not confirm it.
 */
export const SIGN_IN_FAILURES = ["denied", "expired", "failed"] as const;
export type SignInFailure = (typeof SIGN_IN_FAILURES)[number];

/**
 * How a page learns that people can sign in on this deployment: a meta tag the server writes
 * into the head, naming the git host they sign in through. Without it there is no sign-in.
 */
export const AUTH_META_NAME = "skillcdn-auth";

/** The pages of whoever is signed in. */
export const ACCOUNT_PAGE_PATH = "/account";
/** The page that asks a person whether a client may read an address for them. */
export const CONSENT_PAGE_PATH = "/oauth/consent";
/** What the consent page was sent to ask about, as the authorization endpoint sealed it. */
export const CONSENT_REQUEST_PARAM = "request";
/** Why there is nothing to ask: a request the authorization endpoint could not accept. */
export const CONSENT_ERROR_PARAM = "error";

/**
 * Where a browser leaves for the git host to sign in and come back to `returnTo`, a path of this
 * origin.
 */
export function loginPath(returnTo: string): string {
  return `${AUTH_ROUTES.login}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/**
 * The sign-in page, for someone who comes back to `returnTo` afterwards; without one the page
 * decides where a person it signed in goes.
 */
export function signInPagePath(returnTo?: string): string {
  return returnTo === undefined
    ? SIGN_IN_PAGE_PATH
    : `${SIGN_IN_PAGE_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/** The REST path of the page of an account. */
export function ownerRestPath(owner: OwnerPath): string {
  return `${REST_ROUTES.owners}${formatOwnerPath(owner)}`;
}

const count = z.int().check(z.nonnegative());
const accountKind = z.enum(["organization", "user"]);

/** A person who signed in, as the pages show them. Nothing here is a secret. */
export const restUserSchema = z.object({
  host: z.enum(GIT_HOST_KEYS),
  login: z.string(),
  /** The name the account goes by at the host, or `null`. */
  name: z.nullable(z.string()),
  /** The account's picture as the host serves it: an https URL, loaded by the browser. */
  avatar: z.string(),
});
export type RestUser = z.infer<typeof restUserSchema>;

/** `GET /api/v1/me`: who is signed in, or nobody. */
export const restMeSchema = z.object({ user: z.nullable(restUserSchema) });
export type RestMe = z.infer<typeof restMeSchema>;

/**
 * `GET /api/v1/me/repositories`: the repositories the person can reach through the git host's
 * app, by where it is installed, and where to install it on more.
 */
export const restMyRepositoriesSchema = z.object({
  /** Where the app is added to an account or to repositories, at the host; `null` when unknown. */
  installUrl: z.nullable(z.string()),
  installations: z.array(
    z.object({
      account: z.object({ login: z.string(), kind: accountKind, avatar: z.string() }),
      /** Where the person changes which repositories the app may read, at the host. */
      manageUrl: z.nullable(z.string()),
      selection: z.enum(["all", "selected"]),
      repositories: z.array(
        z.object({
          address: z.string(),
          /** As the host spells them, for display. */
          owner: z.string(),
          name: z.string(),
          description: z.nullable(z.string()),
          visibility: z.enum(["public", "private"]),
        }),
      ),
      /** True when the account has more repositories than are listed. */
      truncated: z.boolean(),
    }),
  ),
  /** True when the person can reach more installations than are listed. */
  truncated: z.boolean(),
});
export type RestMyRepositories = z.infer<typeof restMyRepositoriesSchema>;

/** `GET /api/v1/me/grants`: the clients the person let read an address for them. */
export const restGrantsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      client: z.object({
        name: z.string(),
        /** The client's own page, when it names one; shown as text, never followed for it. */
        uri: z.nullable(z.string()),
      }),
      /** The address the client may read: canonical, as the grammar prints it. */
      address: z.string(),
      /** ISO 8601 instants. */
      createdAt: z.string(),
      lastUsedAt: z.nullable(z.string()),
    }),
  ),
});
export type RestGrants = z.infer<typeof restGrantsSchema>;

/** What a repository token begins with, so that whoever finds one knows what it found. */
export const REPO_TOKEN_PREFIX = "scdn_repo_";
/** The longest a repository token may last, in days, and the lifetimes the pages offer. */
export const REPO_TOKEN_MAX_DAYS = 366;
export const REPO_TOKEN_LIFETIMES_DAYS = [7, 30, 90, 365] as const;
export const REPO_TOKEN_DEFAULT_DAYS = 90;
/** How long the name a person gives a token may be. */
export const REPO_TOKEN_MAX_LABEL_LENGTH = 60;

/** A repository token as its maker sees it afterwards: everything but the secret. */
const restRepoTokenSchema = z.object({
  id: z.string(),
  /** The repository it reads: canonical, an address without a ref or a path. */
  address: z.string(),
  /** What its maker called it. */
  label: z.string(),
  /** ISO 8601 instants. */
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.nullable(z.string()),
});

/**
 * `GET /api/v1/me/tokens`: the tokens the person made for agents that have nobody to sign in,
 * newest first, and how many they may hold at once.
 */
export const restRepoTokensSchema = z.object({
  items: z.array(restRepoTokenSchema),
  limit: count,
});
export type RestRepoTokens = z.infer<typeof restRepoTokensSchema>;

/** What `POST /api/v1/me/tokens` is sent: the repository, a name for the token, and its lifetime. */
export const restRepoTokenRequestSchema = z.object({
  /** An address without a ref or a path: `/gh/owner/repo`. */
  address: z.string(),
  label: z.string(),
  expiresInDays: z.int(),
});
export type RestRepoTokenRequest = z.infer<typeof restRepoTokenRequestSchema>;

/** The answer to `POST /api/v1/me/tokens`: the secret, this once, and what was stored about it. */
export const restNewRepoTokenSchema = z.object({
  token: z.string(),
  item: restRepoTokenSchema,
});
export type RestNewRepoToken = z.infer<typeof restNewRepoTokenSchema>;

/**
 * `GET /api/v1/owners/gh/<owner>`: an account of the git host as everyone sees it, the public
 * repositories of it that this deployment has indexed and found skills in, and a page of its
 * other public repositories as the host lists them. Listing indexes nothing.
 */
export const restOwnerSchema = z.object({
  owner: z.object({
    host: z.enum(GIT_HOST_KEYS),
    /** As the host spells it, for display. */
    login: z.string(),
    name: z.nullable(z.string()),
    kind: accountKind,
    avatar: z.string(),
    bio: z.nullable(z.string()),
    /** The account's page at the host. */
    url: z.string(),
    publicRepositories: count,
  }),
  /** On the first page only: what is already indexed and has skills, most skills first. */
  indexed: z.array(restRepositoryCardSchema),
  /** The rest, most recently pushed first, without what `indexed` already shows. */
  repositories: z.array(
    z.object({
      address: z.string(),
      name: z.string(),
      description: z.nullable(z.string()),
      fork: z.boolean(),
      archived: z.boolean(),
      stars: count,
      /** An ISO 8601 instant, or `null` when the host does not say. */
      pushedAt: z.nullable(z.string()),
    }),
  ),
  /** The page to ask for next, or `null` when this is the last. */
  nextPage: z.nullable(z.int()),
});
export type RestOwner = z.infer<typeof restOwnerSchema>;

/**
 * `GET /api/v1/oauth/request`: what a client asked to be authorized for, for the consent page to
 * show before anyone agrees to it.
 */
export const restAuthorizationSchema = z.object({
  client: z.object({
    /** What the client calls itself. It is the client's word: shown as text, vouched for by nobody. */
    name: z.string(),
    uri: z.nullable(z.string()),
    /**
     * Who the person is sent back to with the answer, which is what actually receives the
     * access: the host of a web address, or the scheme of an app's own (`cursor:`). Never a
     * host that an app's own scheme merely writes after itself.
     */
    redirectHost: z.string(),
    /**
     * True when that is an app on the person's own computer rather than a site: one of the
     * computer's own addresses, or a link scheme an installed app answers to.
     */
    loopback: z.boolean(),
  }),
  /** The address the client asks to read: canonical, as the grammar prints it. */
  address: z.string(),
  scope: z.array(z.string()),
  /** Who is signed in and would be agreeing; `null` when nobody is. */
  user: z.nullable(restUserSchema),
  /**
   * Whether that person can see the repository right now; `null` while nobody is signed in. A
   * repository that does not exist and one they may not see are the same `false`.
   */
  visible: z.nullable(z.boolean()),
  /** Where the app is added to repositories at the host, for when `visible` is false. */
  installUrl: z.nullable(z.string()),
});
export type RestAuthorization = z.infer<typeof restAuthorizationSchema>;

/** The answer to `POST /api/v1/oauth/decision`: where the browser goes with the person's answer. */
export const restAuthorizationDecisionSchema = z.object({ redirect: z.string() });
export type RestAuthorizationDecision = z.infer<typeof restAuthorizationDecisionSchema>;
