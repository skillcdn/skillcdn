import { createHash } from "node:crypto";
import {
  GitHostError,
  type GitHostLogin,
  type HostCredentials,
  type HostUser,
} from "@skillcdn/core";
import { fixtureRepoId, INSTALLED_PRIVATE_REPOSITORIES } from "./fixture-host.js";

// Test support: the git host's side of signing in, for a handful of people. Who can see which
// of the fixture host's private repositories is decided here, as a real host decides it.

export interface FixturePerson {
  readonly user: HostUser;
  /** The private repositories of `acme` this person can see, by name. */
  readonly sees: string[];
}

export interface FixtureLogin extends GitHostLogin {
  readonly people: Record<string, FixturePerson>;
  /** Calls per port method, to assert how often the host was asked. */
  readonly calls: Record<
    "exchangeCode" | "refresh" | "getUser" | "visibleRepository" | "listInstallations",
    number
  >;
  /**
   * The code the host would send a person's browser back with, for the sign-in that was
   * started with `state`.
   */
  codeFor(person: string, state: string): string;
  /** Makes every token the host issued a person worthless, as revoking the app does. */
  revoke(person: string): void;
  /** Makes the tokens the host issued so far expire at once, while refresh tokens stay good. */
  expireAccessTokens(): void;
  /** Makes every call fail as a host that cannot be reached does, until called with `false`. */
  unreachable(down: boolean): void;
}

export const FIXTURE_WEB_URL = "https://git.test";
export const FIXTURE_INSTALL_URL = `${FIXTURE_WEB_URL}/apps/skillcdn-test/installations/new`;

interface Issued {
  readonly person: string;
  readonly kind: "access" | "refresh";
  expired: boolean;
}

/**
 * `alice` can see both private repositories, `bob` one of them, `carol` none; `options.expiring`
 * makes the host issue access tokens that expire, with refresh tokens, as a real one can.
 */
export function createFixtureLogin(
  options: { readonly expiring?: boolean; readonly now?: () => Date } = {},
): FixtureLogin {
  const now = options.now ?? (() => new Date());
  const people: Record<string, FixturePerson> = {
    alice: {
      user: { hostAccountId: "1001", login: "Alice", name: "Alice Example" },
      sees: Object.keys(INSTALLED_PRIVATE_REPOSITORIES),
    },
    bob: {
      user: { hostAccountId: "1002", login: "bob", name: undefined },
      sees: ["secret-skills"],
    },
    carol: { user: { hostAccountId: "1003", login: "carol", name: "Carol" }, sees: [] },
  };
  const calls = {
    exchangeCode: 0,
    refresh: 0,
    getUser: 0,
    visibleRepository: 0,
    listInstallations: 0,
  };
  /** What a sign-in was started with, by its state: the challenge a code is redeemed against. */
  const started = new Map<string, string>();
  const codes = new Map<string, { readonly person: string; readonly challenge: string }>();
  const tokens = new Map<string, Issued>();
  let issued = 0;
  let down = false;

  const reach = (): void => {
    if (down) {
      throw new GitHostError("transient", "the git host could not be reached");
    }
  };

  const issue = (person: string): HostCredentials => {
    issued += 1;
    const accessToken = `ghu_${person}_${issued}`;
    tokens.set(accessToken, { person, kind: "access", expired: false });
    if (options.expiring !== true) {
      return {
        accessToken,
        accessExpiresAt: undefined,
        refreshToken: undefined,
        refreshExpiresAt: undefined,
      };
    }
    const refreshToken = `ghr_${person}_${issued}`;
    tokens.set(refreshToken, { person, kind: "refresh", expired: false });
    return {
      accessToken,
      accessExpiresAt: new Date(now().getTime() + 8 * 3_600_000),
      refreshToken,
      refreshExpiresAt: new Date(now().getTime() + 180 * 86_400_000),
    };
  };

  /** The person a usable access token belongs to; a token the host no longer accepts is refused. */
  const holder = (accessToken: string): FixturePerson => {
    reach();
    const token = tokens.get(accessToken);
    const person = token?.kind === "access" && !token.expired ? people[token.person] : undefined;
    if (person === undefined) {
      throw new GitHostError("unauthorized", "the git host refused the credential");
    }
    return person;
  };

  return {
    people,
    calls,
    codeFor(person, state) {
      const challenge = started.get(state);
      if (challenge === undefined || people[person] === undefined) {
        throw new Error(`no sign-in was started with state ${state}`);
      }
      const code = `code_${person}_${codes.size + 1}`;
      codes.set(code, { person, challenge });
      return code;
    },
    revoke(person) {
      for (const [token, entry] of tokens) {
        if (entry.person === person) {
          tokens.delete(token);
        }
      }
    },
    expireAccessTokens() {
      for (const entry of tokens.values()) {
        if (entry.kind === "access") {
          entry.expired = true;
        }
      }
    },
    unreachable(value) {
      down = value;
    },

    authorizationUrl(request) {
      started.set(request.state, request.codeChallenge);
      const query = new URLSearchParams({
        state: request.state,
        redirect_uri: request.redirectUri,
        code_challenge: request.codeChallenge,
        ...(request.chooseAccount === true ? { prompt: "select_account" } : {}),
      });
      return `${FIXTURE_WEB_URL}/login/oauth/authorize?${query}`;
    },

    async exchangeCode(request) {
      calls.exchangeCode += 1;
      reach();
      const code = codes.get(request.code);
      codes.delete(request.code);
      const challenge = createHash("sha256").update(request.codeVerifier).digest("base64url");
      if (code === undefined || code.challenge !== challenge) {
        throw new GitHostError("unauthorized", "the git host refused the token request");
      }
      return issue(code.person);
    },

    async refresh(refreshToken) {
      calls.refresh += 1;
      reach();
      const token = tokens.get(refreshToken);
      if (token === undefined || token.kind !== "refresh") {
        throw new GitHostError("unauthorized", "the git host refused the token request");
      }
      // Good once: the host issues a new pair and forgets the old one.
      tokens.delete(refreshToken);
      return issue(token.person);
    },

    async getUser(accessToken) {
      calls.getUser += 1;
      return holder(accessToken).user;
    },

    async visibleRepository(accessToken, coordinates) {
      calls.visibleRepository += 1;
      const person = holder(accessToken);
      return coordinates.owner === "acme" && person.sees.includes(coordinates.repo)
        ? fixtureRepoId(coordinates.repo)
        : undefined;
    },

    async listInstallations(accessToken) {
      calls.listInstallations += 1;
      const person = holder(accessToken);
      if (person.sees.length === 0) {
        return { installations: [], truncated: false };
      }
      return {
        installations: [
          {
            account: { hostAccountId: "42", login: "Acme", kind: "organization" },
            manageUrl: `${FIXTURE_WEB_URL}/organizations/Acme/settings/installations/7`,
            selection: "selected",
            repositories: person.sees.map((name) => ({
              hostRepoId: fixtureRepoId(name),
              owner: "Acme",
              name,
              description: "Skills only Acme's own people see.",
              visibility: "private",
            })),
            truncated: false,
          },
        ],
        truncated: false,
      };
    },

    async installUrl() {
      return FIXTURE_INSTALL_URL;
    },
  };
}
