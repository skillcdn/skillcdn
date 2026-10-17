import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Where the command keeps what `login` was given (ADR-0056): for every deployment a person gave
// it a token for, the deployment's origin and the token, in the person's own configuration
// directory, readable by them alone where the system can say so. A token is a secret the person
// made at the deployment; this file is the one place it rests, and a token goes only to the
// origin it was kept for: the command resolves which deployment a read goes to first, and then
// looks for the login there, never the other way round.

/** One login: a deployment, and the token the person made there. */
export interface Login {
  /** The origin of the deployment, without a path. */
  readonly url: string;
  readonly token: string;
  /** When the login was kept, when known. */
  readonly since: string | undefined;
}

export interface Credentials {
  readonly logins: readonly Login[];
}

export const EMPTY_CREDENTIALS: Credentials = { logins: [] };

/** How many deployments one machine may be signed in to: far more than anyone has. */
export const MAX_LOGINS = 100;
/** How large the file may be before it is not read: far above a hundred logins. */
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 1024;

export interface CredentialStore {
  /**
   * What is kept, or nothing. A file that is there and cannot be read is a `CredentialsError`,
   * so that the command stops and never writes over what it did not understand.
   */
  load(): Promise<Credentials | undefined>;
  /** Keeps the credentials, whole, and answers where. */
  save(credentials: Credentials): Promise<string>;
}

export class CredentialsError extends Error {
  readonly code: "credentials.malformed" | "credentials.too_large";
  readonly path: string;

  constructor(code: CredentialsError["code"], path: string) {
    super(
      code === "credentials.too_large"
        ? `The credentials file ${path} is larger than the command reads.`
        : `The credentials file ${path} could not be read as one.`,
    );
    this.name = "CredentialsError";
    this.code = code;
    this.path = path;
  }
}

/** An origin as the command keeps one: `https://host[:port]`, or `http://` for this machine only. */
export function originOf(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") {
    return undefined;
  }
  return url.origin;
}

/** What a file says, with nothing but the logins kept; nothing for anything else. */
export function parseCredentials(json: unknown): Credentials | undefined {
  if (typeof json !== "object" || json === null || !("logins" in json)) {
    return undefined;
  }
  const { logins } = json as { readonly logins?: unknown };
  if (!Array.isArray(logins) || logins.length > MAX_LOGINS) {
    return undefined;
  }
  const read: Login[] = [];
  for (const login of logins as readonly unknown[]) {
    if (typeof login !== "object" || login === null) {
      return undefined;
    }
    const { url, token, since } = login as {
      readonly url?: unknown;
      readonly token?: unknown;
      readonly since?: unknown;
    };
    if (
      typeof url !== "string" ||
      originOf(url) !== url ||
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH ||
      (since !== undefined && typeof since !== "string")
    ) {
      return undefined;
    }
    read.push({ url, token, since: since === undefined ? undefined : since.slice(0, 40) });
  }
  return { logins: read };
}

/** The login at one deployment, when there is one. */
export function loginAt(credentials: Credentials, url: string): Login | undefined {
  return credentials.logins.find((login) => login.url === url);
}

/** With a login kept, in place of the one at the same deployment. */
export function withLogin(credentials: Credentials, login: Login): Credentials {
  return {
    logins: [...credentials.logins.filter((kept) => kept.url !== login.url), login],
  };
}

/** Without the login at a deployment. */
export function withoutLogin(credentials: Credentials, url: string): Credentials {
  return { logins: credentials.logins.filter((kept) => kept.url !== url) };
}

const FILE_NAME = "credentials.json";

/** The directory the file lives in: under `XDG_CONFIG_HOME`, or `~/.config`. */
export function defaultConfigDir(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const base = env.XDG_CONFIG_HOME;
  return join(base === undefined || base.length === 0 ? join(home, ".config") : base, "skillcdn");
}

export function createFileStore(directory: string, pid: number): CredentialStore {
  const path = join(directory, FILE_NAME);
  return {
    async load() {
      let size: number;
      try {
        size = (await stat(path)).size;
      } catch {
        return undefined;
      }
      if (size > MAX_FILE_BYTES) {
        throw new CredentialsError("credentials.too_large", path);
      }
      let json: unknown;
      try {
        json = JSON.parse(await readFile(path, "utf8"));
      } catch {
        throw new CredentialsError("credentials.malformed", path);
      }
      const parsed = parseCredentials(json);
      if (parsed === undefined) {
        throw new CredentialsError("credentials.malformed", path);
      }
      return parsed;
    },
    async save(credentials) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = {
        version: 1,
        logins: credentials.logins.map((login) => ({
          url: login.url,
          token: login.token,
          since: login.since,
        })),
      };
      // Written beside the file and moved over it in one step, so that a command that stops
      // half-way leaves the file as it was, whole.
      const draft = `${path}.${pid}.tmp`;
      await writeFile(draft, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await rename(draft, path);
      // The mode above applies to a file made now; one that was there keeps its own, so it is set again.
      await chmod(path, 0o600).catch(() => undefined);
      return path;
    },
  };
}

/** A store in memory, for a test, and for a command that has nowhere to keep a file. */
export function createMemoryStore(initial?: Credentials): CredentialStore {
  let kept = initial;
  return {
    async load() {
      return kept;
    },
    async save(credentials) {
      kept = credentials;
      return "(memory)";
    },
  };
}

/** Forgets the file, for a test. */
export async function removeFileStore(directory: string): Promise<void> {
  await rm(join(directory, FILE_NAME), { force: true });
}
