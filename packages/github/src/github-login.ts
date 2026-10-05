import {
  GitHostError,
  type GitHostLogin,
  type HostCredentials,
  type HostInstallation,
  type HostInstallations,
  type HostUser,
  type RepoCoordinates,
} from "@skillcdn/core";
import * as z from "zod";
import {
  cleanDescription,
  connectGitHub,
  GITHUB_API_BASE_URL,
  type GitHubConnection,
  type GitHubHostOptions,
} from "./github-host.js";
import { type RequestCredential, readBody } from "./http.js";
import { decodeJson } from "./json.js";

export interface GitHubLoginOptions extends GitHubHostOptions {
  /**
   * Where people use the host in a browser: where they sign in, and where the token endpoint
   * is. Operator configuration; derived from the API's base URL when left out.
   */
  readonly webUrl?: string;
  /** The client id and secret the host issued the app for signing people in. */
  readonly clientId: string;
  readonly clientSecret: string;
}

const JSON_ACCEPT = "application/vnd.github+json";
/** How many installations, and how many repositories of each, a listing shows. */
const MAX_INSTALLATIONS = 30;
const MAX_INSTALLED_REPOSITORIES = 100;
/** A token reply is a few hundred bytes; this bounds what a misbehaving upstream can send. */
const MAX_TOKEN_REPLY_BYTES = 64 * 1024;

/**
 * Where people use the host in a browser, from where its API is: github.com for
 * api.github.com, a host without its `api.` label otherwise, and the origin itself for an
 * installation that serves its API under a path.
 */
export function githubWebUrl(apiUrl: string = GITHUB_API_BASE_URL): string {
  const url = new URL(apiUrl);
  return url.hostname.startsWith("api.")
    ? `${url.protocol}//${url.host.slice("api.".length)}`
    : url.origin;
}

const tokenReplySchema = z.union([
  z.object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
    refresh_token: z.string().min(1).optional(),
    refresh_token_expires_in: z.number().int().positive().optional(),
  }),
  z.object({ error: z.string().min(1) }),
]);

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
});

const visibleRepositorySchema = z.object({ id: z.number().int().positive() });

const accountSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  type: z.string().optional(),
});

const installationsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      account: accountSchema.nullable().optional(),
      repository_selection: z.string().optional(),
      html_url: z.string().optional(),
      suspended_at: z.string().nullable().optional(),
    }),
  ),
});

const installedRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      private: z.boolean(),
      visibility: z.string().optional(),
      description: z.string().nullable().optional(),
      owner: z.object({ login: z.string().min(1) }),
    }),
  ),
});

/** Codes of the token endpoint that say the code or the refresh token is no good any more. */
const REFUSED_GRANTS = new Set(["bad_verification_code", "bad_refresh_token"]);

/**
 * The GitHub implementation of the login port: people sign in through the app's own client,
 * and their credential is used to ask the host what they can see through the app. A person's
 * credential arrives as an argument and leaves in the request it is sent with, nowhere else.
 */
export function createGitHubLogin(
  options: GitHubLoginOptions,
  connection: GitHubConnection = connectGitHub(options),
): GitHostLogin {
  const { http, app } = connection;
  const webUrl = (options.webUrl ?? githubWebUrl(options.baseUrl)).replace(/\/+$/, "");
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const as = (accessToken: string): RequestCredential => ({ bearer: accessToken, of: "user" });

  /** Asks the host's token endpoint, which answers 200 with an error in the body as well. */
  const requestToken = async (parameters: Record<string, string>): Promise<HostCredentials> => {
    let response: Response;
    try {
      response = await send(`${webUrl}/login/oauth/access_token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": options.userAgent,
        },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          ...parameters,
        }).toString(),
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch (error) {
      throw new GitHostError("transient", "the git host could not be reached", { cause: error });
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new GitHostError(
        response.status === 429 ? "rate_limited" : "transient",
        `the git host answered ${response.status}`,
      );
    }
    const issuedAt = now();
    const bytes = response.ok ? await readBody(response, MAX_TOKEN_REPLY_BYTES) : undefined;
    if (bytes === undefined) {
      await response.body?.cancel();
      throw new GitHostError(
        "invalid",
        `the git host rejected the token request (${response.status})`,
      );
    }
    const reply = decodeJson(bytes, tokenReplySchema);
    if ("error" in reply) {
      // The code names what is wrong and is not a secret; the description may quote the request.
      const code = reply.error.slice(0, 64).replaceAll(/[^a-z_]/g, "");
      throw new GitHostError(
        REFUSED_GRANTS.has(code) ? "unauthorized" : "invalid",
        `the git host refused the token request (${code})`,
      );
    }
    return {
      accessToken: reply.access_token,
      accessExpiresAt:
        reply.expires_in === undefined ? undefined : new Date(issuedAt + reply.expires_in * 1000),
      refreshToken: reply.refresh_token,
      refreshExpiresAt:
        reply.refresh_token_expires_in === undefined
          ? undefined
          : new Date(issuedAt + reply.refresh_token_expires_in * 1000),
    };
  };

  /** A link the host wrote, when it leads to the host and nowhere else. */
  const hostLink = (value: string | undefined): string | undefined =>
    value?.startsWith(`${webUrl}/`) === true ? value : undefined;

  return {
    authorizationUrl(request) {
      const query = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: request.redirectUri,
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        // The host's own account picker, every time: it shows which account the person
        // continues with and the way to another. Without it the host shows a page only the
        // first time, or to someone signed in to several accounts, and otherwise sends the
        // browser straight back as whoever its own session has.
        prompt: "select_account",
      });
      return `${webUrl}/login/oauth/authorize?${query}`;
    },

    exchangeCode(request) {
      return requestToken({
        code: request.code,
        redirect_uri: request.redirectUri,
        code_verifier: request.codeVerifier,
      });
    },

    refresh(refreshToken) {
      return requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    },

    async getUser(accessToken): Promise<HostUser> {
      const reply = await http.get("/user", { accept: JSON_ACCEPT, credential: as(accessToken) });
      const user = decodeJson(reply.body, userSchema);
      return {
        hostAccountId: String(user.id),
        login: user.login,
        name: cleanDescription(user.name),
      };
    },

    async visibleRepository(
      accessToken: string,
      coordinates: RepoCoordinates,
    ): Promise<string | undefined> {
      try {
        // The token of an app's user sees what both the person and the app's installation
        // can: the answer is the question "may this person read it here" itself.
        const reply = await http.get(
          `/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}`,
          { accept: JSON_ACCEPT, credential: as(accessToken) },
        );
        return String(decodeJson(reply.body, visibleRepositorySchema).id);
      } catch (error) {
        if (error instanceof GitHostError && error.kind === "not_found") {
          return undefined;
        }
        throw error;
      }
    },

    async listInstallations(accessToken): Promise<HostInstallations> {
      const credential = as(accessToken);
      const reply = await http.get(`/user/installations?per_page=${MAX_INSTALLATIONS}`, {
        accept: JSON_ACCEPT,
        credential,
      });
      const listed = decodeJson(reply.body, installationsSchema);
      const installations = await Promise.all(
        listed.installations
          .filter((entry) => entry.suspended_at == null && entry.account != null)
          .map(async (entry): Promise<HostInstallation[]> => {
            const account = entry.account;
            if (account == null) {
              return [];
            }
            const answer = await http.get(
              `/user/installations/${entry.id}/repositories?per_page=${MAX_INSTALLED_REPOSITORIES}`,
              { accept: JSON_ACCEPT, credential },
            );
            const repositories = decodeJson(answer.body, installedRepositoriesSchema);
            return [
              {
                account: {
                  hostAccountId: String(account.id),
                  login: account.login,
                  kind: account.type === "Organization" ? "organization" : "user",
                },
                manageUrl: hostLink(entry.html_url),
                selection: entry.repository_selection === "all" ? "all" : "selected",
                repositories: repositories.repositories.map((repository) => ({
                  hostRepoId: String(repository.id),
                  owner: repository.owner.login,
                  name: repository.name,
                  description: cleanDescription(repository.description),
                  visibility:
                    !repository.private && (repository.visibility ?? "public") === "public"
                      ? "public"
                      : "private",
                })),
                truncated: repositories.total_count > repositories.repositories.length,
              },
            ];
          }),
      );
      return {
        installations: installations.flat(),
        truncated: listed.total_count > listed.installations.length,
      };
    },

    async installUrl(): Promise<string | undefined> {
      const page = hostLink(await app?.page());
      return page === undefined ? undefined : `${page.replace(/\/+$/, "")}/installations/new`;
    },
  };
}
