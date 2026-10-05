import type { HostAccount, RepoCoordinates } from "./git-host.js";

/** A person as the git host knows them, told by the credential they signed in with. */
export interface HostUser {
  /** The host's immutable id for the account. */
  readonly hostAccountId: string;
  readonly login: string;
  /** The name the account goes by, when it gives one besides its login. */
  readonly name: string | undefined;
}

/**
 * What the git host issues a person who signs in. It stays on the server: it is stored encrypted,
 * used only to ask the host what that person can see, and never handed to an agent or a browser.
 */
export interface HostCredentials {
  readonly accessToken: string;
  /** `undefined`: the host issued a token that does not expire. */
  readonly accessExpiresAt: Date | undefined;
  /** What a new access token is asked for with, when the host issues expiring ones. */
  readonly refreshToken: string | undefined;
  readonly refreshExpiresAt: Date | undefined;
}

/** A repository a person can reach through the app, as the host lists it. */
export interface HostInstalledRepository {
  readonly hostRepoId: string;
  /** As the host spells them. */
  readonly owner: string;
  readonly name: string;
  readonly description: string | undefined;
  /** Anything the host does not report as public is `private`. */
  readonly visibility: "public" | "private";
}

/** One place the app is installed that the person can reach: an account, and repositories of it. */
export interface HostInstallation {
  readonly account: HostAccount;
  /** Where the person changes which repositories the app may read, at the host. */
  readonly manageUrl: string | undefined;
  /** Whether the app may read every repository of the account or a chosen few. */
  readonly selection: "all" | "selected";
  readonly repositories: readonly HostInstalledRepository[];
  /** True when the account has more repositories than are listed. */
  readonly truncated: boolean;
}

export interface HostInstallations {
  readonly installations: readonly HostInstallation[];
  /** True when the person can reach more installations than are listed. */
  readonly truncated: boolean;
}

/**
 * What the domain needs from a git host about people: signing them in, and asking the host what
 * they can see. The host owns permissions; this port only ever asks. Every method rejects with a
 * `GitHostError`; a credential the host no longer accepts is `unauthorized`.
 */
export interface GitHostLogin {
  /**
   * Where a browser is sent to sign in. `codeChallenge` is the S256 challenge of the verifier.
   * `chooseAccount` asks the host to let the person pick which of their accounts to continue
   * with, where it can, instead of taking the one its own session has.
   */
  authorizationUrl(request: {
    readonly state: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly chooseAccount?: boolean;
  }): string;

  /** Exchanges the code a sign-in came back with. A code the host refuses is `unauthorized`. */
  exchangeCode(request: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<HostCredentials>;

  /** A new credential for one that expired. A refresh token the host refuses is `unauthorized`. */
  refresh(refreshToken: string): Promise<HostCredentials>;

  getUser(accessToken: string): Promise<HostUser>;

  /**
   * The host's immutable id of the repository when whoever holds the token can see it through
   * the app, and `undefined` when they cannot or it does not exist: the two are not told apart.
   */
  visibleRepository(accessToken: string, coordinates: RepoCoordinates): Promise<string | undefined>;

  /** Where the app is installed, as far as this person can reach, with the repositories there. */
  listInstallations(accessToken: string): Promise<HostInstallations>;

  /** Where a person adds the app to an account or to repositories, at the host. */
  installUrl(): Promise<string | undefined>;
}
