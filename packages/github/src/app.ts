import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { GitHostError, type RepoCoordinates } from "@skillcdn/core";
import * as z from "zod";
import type { GitHubHttp, RequestCredential } from "./http.js";
import { decodeJson } from "./json.js";

/** What makes the adapter the app the operator registered at the host. */
export interface GitHubAppCredentials {
  /** The app's id, or its client id: what the host calls the issuer of the app's tokens. */
  readonly appId: string;
  /** The app's private key, as the PEM the host handed out. */
  readonly privateKey: string;
}

const JSON_ACCEPT = "application/vnd.github+json";
/** The host accepts a proof of identity for at most ten minutes. */
const PROOF_LIFETIME_SECONDS = 540;
/** Clocks differ: a proof says it was issued a little earlier than it was. */
const PROOF_BACKDATE_SECONDS = 60;
/** How long before its end a token is no longer handed out. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** How long the answer to "is the app installed here" is believed, found or not. */
const INSTALLATION_TTL_MS = 60_000;
const MAX_REMEMBERED = 5000;

const installationSchema = z.object({ id: z.number().int().positive() });
const installationTokenSchema = z.object({ token: z.string().min(1), expires_at: z.string() });
const aboutSchema = z.object({ html_url: z.string() });

const base64Url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

/** Forgets the oldest of what a bounded map remembers. */
function bounded<Value>(map: Map<string, Value>, key: string, value: Value): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

/**
 * The app as the host knows it: it proves who it is with its private key, learns where it is
 * installed, and is issued a short-lived token for each installation, which is what a private
 * repository is read with. Nothing here ever holds a person's credential.
 */
export class GitHubApp {
  readonly #http: GitHubHttp;
  readonly #appId: string;
  readonly #key: KeyObject;
  readonly #now: () => number;
  #proof: { readonly bearer: string; readonly until: number } | undefined;
  /** By `owner/repo`: the installation that covers the repository, or that there is none. */
  readonly #installations = new Map<
    string,
    { readonly id: string | undefined; readonly until: number }
  >();
  /** By installation: the token in hand, and the request for one that is on its way. */
  readonly #tokens = new Map<string, { readonly token: string; readonly until: number }>();
  readonly #issuing = new Map<string, Promise<string>>();
  #about: Promise<string | undefined> | undefined;

  constructor(http: GitHubHttp, credentials: GitHubAppCredentials, now: () => number) {
    this.#http = http;
    this.#appId = credentials.appId;
    // Fails here, at startup, when the key is not one: never at the first private repository.
    this.#key = createPrivateKey(credentials.privateKey);
    this.#now = now;
  }

  /** The credential that says "this is the app": a signed statement the host verifies. */
  #identity(): RequestCredential {
    const now = this.#now();
    if (this.#proof === undefined || this.#proof.until <= now) {
      const issued = Math.floor(now / 1000) - PROOF_BACKDATE_SECONDS;
      const head = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = base64Url(
        JSON.stringify({
          iat: issued,
          exp: issued + PROOF_BACKDATE_SECONDS + PROOF_LIFETIME_SECONDS,
          iss: this.#appId,
        }),
      );
      const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(this.#key);
      this.#proof = {
        bearer: `${head}.${claims}.${base64Url(signature)}`,
        // Renewed well before the host stops accepting it.
        until: now + (PROOF_LIFETIME_SECONDS * 1000) / 2,
      };
    }
    return { bearer: this.#proof.bearer, of: "app" };
  }

  /** The installation that lets the app read the repository; `undefined` when there is none. */
  async #installationOf(coordinates: RepoCoordinates): Promise<string | undefined> {
    const name = `${coordinates.owner}/${coordinates.repo}`;
    const known = this.#installations.get(name);
    if (known !== undefined && known.until > this.#now()) {
      return known.id;
    }
    let id: string | undefined;
    try {
      const reply = await this.#http.get(
        `/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}/installation`,
        { accept: JSON_ACCEPT, credential: this.#identity() },
      );
      id = String(decodeJson(reply.body, installationSchema).id);
    } catch (error) {
      if (!(error instanceof GitHostError) || error.kind !== "not_found") {
        throw error;
      }
    }
    bounded(this.#installations, name, { id, until: this.#now() + INSTALLATION_TTL_MS });
    return id;
  }

  async #issue(installation: string): Promise<string> {
    const reply = await this.#http.post(
      `/app/installations/${encodeURIComponent(installation)}/access_tokens`,
      // Whatever the app was granted, reading is all a token of ours can do.
      { permissions: { contents: "read", metadata: "read" } },
      // 422: the installation was not granted what is asked for, so it cannot be read with.
      { accept: JSON_ACCEPT, credential: this.#identity(), notFoundStatuses: [422] },
    );
    const issued = decodeJson(reply.body, installationTokenSchema);
    const expires = Date.parse(issued.expires_at);
    if (!Number.isFinite(expires)) {
      throw new GitHostError("invalid", "the git host issued a token without a valid expiry");
    }
    bounded(this.#tokens, installation, { token: issued.token, until: expires - EXPIRY_MARGIN_MS });
    return issued.token;
  }

  /**
   * The credential a repository is read with through the app's installation on it, or
   * `undefined` when the app is not installed there. Callers must not tell that apart from a
   * repository that does not exist.
   */
  async installationCredential(
    coordinates: RepoCoordinates,
  ): Promise<RequestCredential | undefined> {
    const installation = await this.#installationOf(coordinates);
    if (installation === undefined) {
      return undefined;
    }
    const held = this.#tokens.get(installation);
    if (held !== undefined && held.until > this.#now()) {
      return { bearer: held.token, of: "installation" };
    }
    // Requests that arrive together share one token instead of each asking for its own.
    let issuing = this.#issuing.get(installation);
    if (issuing === undefined) {
      issuing = this.#issue(installation).finally(() => {
        this.#issuing.delete(installation);
      });
      this.#issuing.set(installation, issuing);
    }
    try {
      return { bearer: await issuing, of: "installation" };
    } catch (error) {
      if (error instanceof GitHostError && error.kind === "not_found") {
        // Uninstalled or suspended since it was looked up.
        this.#installations.delete(`${coordinates.owner}/${coordinates.repo}`);
        return undefined;
      }
      throw error;
    }
  }

  /** The app's page at the host, as the host states it; `undefined` when it cannot be asked. */
  page(): Promise<string | undefined> {
    this.#about ??= this.#http
      .get("/app", { accept: JSON_ACCEPT, credential: this.#identity() })
      .then((reply) => decodeJson(reply.body, aboutSchema).html_url)
      .catch(() => {
        // Asked again next time: the host may only have been out of reach.
        this.#about = undefined;
        return undefined;
      });
    return this.#about;
  }
}
