import { type Clock, hasForbiddenCodePoint } from "@skillcdn/core";
import {
  countUnusedOAuthClients,
  type Database,
  findOAuthClient,
  type OAuthClientAuthMethod,
  type OAuthClientRecord,
  saveOAuthClient,
} from "@skillcdn/db";
import * as z from "zod";
import type { Logger } from "../../logger.js";
import { hashToken, newToken } from "../secrets.js";
import type { DocumentFetcher } from "./document-fetch.js";
import { MAX_REDIRECT_URI_LENGTH, redirectUriProblem } from "./redirects.js";

// The clients that ask people for access (docs/specs/permissions.md). A client is either one
// that registered itself here (RFC 7591), or one that identifies itself with the https URL of a
// metadata document, which is fetched and kept for a while. Either way, what a client says
// about itself is its own word; what is checked is where it may be sent back to.

export const MAX_CLIENT_ID_LENGTH = 1024;
const MAX_REDIRECT_URIS = 16;
const MAX_NAME_LENGTH = 80;
const FALLBACK_NAME = "Unnamed client";
/** How long a document is kept when it does not say, and the least and the most it may say. */
const DOCUMENT_TTL_MS = 60 * 60_000;
const MIN_DOCUMENT_TTL_MS = 5 * 60_000;
const MAX_DOCUMENT_TTL_MS = 24 * 60 * 60_000;
/**
 * How many clients may be stored that nobody ever allowed anything, and how long the count is
 * believed before the database is asked again. Anyone can make such a client, and one is kept
 * for a week: past this many, no new one is stored until some are gone.
 */
const MAX_UNUSED_CLIENTS = 10_000;
const UNUSED_COUNT_TTL_MS = 30_000;
/** How long a document that could not be read is not asked for again. */
const DOCUMENT_RETRY_MS = 60_000;
const MAX_REMEMBERED_FAILURES = 1000;

const SECRET_METHODS: readonly OAuthClientAuthMethod[] = [
  "client_secret_basic",
  "client_secret_post",
];

/** What a client says about itself, when it registers or in its document. Unknown fields are its own. */
const metadataSchema = z.looseObject({
  redirect_uris: z
    .array(z.string().min(1).max(MAX_REDIRECT_URI_LENGTH))
    .min(1)
    .max(MAX_REDIRECT_URIS),
  client_name: z.string().max(400).optional(),
  client_uri: z.string().max(1024).optional(),
  token_endpoint_auth_method: z.string().max(64).optional(),
  grant_types: z.array(z.string().max(64)).max(16).optional(),
  response_types: z.array(z.string().max(64)).max(16).optional(),
});

/** No new client can be stored right now: too many are waiting for somebody to allow them. */
export class ClientLimitError extends Error {
  /** When trying again may help. */
  readonly retryAfterSeconds = 3600;

  constructor() {
    super("Too many clients are registered that nobody has used yet. Try again later.");
    this.name = "ClientLimitError";
  }
}

export class ClientMetadataError extends Error {
  readonly code: "invalid_redirect_uri" | "invalid_client_metadata";

  constructor(code: "invalid_redirect_uri" | "invalid_client_metadata", message: string) {
    super(message);
    this.name = "ClientMetadataError";
    this.code = code;
  }
}

/** A name fit to show a person: one line, printable, short. The client's own word still. */
function displayName(value: string | undefined): string {
  const name = (value ?? "").replaceAll(/\s+/g, " ").trim();
  return name.length === 0 || hasForbiddenCodePoint(name)
    ? FALLBACK_NAME
    : name.slice(0, MAX_NAME_LENGTH);
}

/** The client's own page, when it names an https one. Shown as text; nothing is fetched from it. */
function pageOf(value: string | undefined): string | undefined {
  const url = value === undefined ? null : URL.parse(value);
  return url !== null && url.protocol === "https:" && !hasForbiddenCodePoint(url.href)
    ? url.href
    : undefined;
}

interface ClientFacts {
  readonly name: string;
  readonly uri: string | undefined;
  readonly redirectUris: readonly string[];
  readonly requestedAuthMethod: string | undefined;
}

function readMetadata(metadata: unknown): ClientFacts {
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))];
    throw new ClientMetadataError(
      names.includes("redirect_uris") ? "invalid_redirect_uri" : "invalid_client_metadata",
      `Missing or malformed client metadata: ${names.join(", ")}.`,
    );
  }
  const data = parsed.data;
  for (const uri of data.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem !== undefined) {
      throw new ClientMetadataError("invalid_redirect_uri", `${problem}.`);
    }
  }
  // This server issues codes and exchanges them, and nothing else.
  if (data.grant_types !== undefined && !data.grant_types.includes("authorization_code")) {
    throw new ClientMetadataError(
      "invalid_client_metadata",
      "grant_types must include authorization_code.",
    );
  }
  if (data.response_types !== undefined && !data.response_types.includes("code")) {
    throw new ClientMetadataError("invalid_client_metadata", "response_types must include code.");
  }
  return {
    name: displayName(data.client_name),
    uri: pageOf(data.client_uri),
    redirectUris: [...new Set(data.redirect_uris)],
    requestedAuthMethod: data.token_endpoint_auth_method,
  };
}

/**
 * Whether a client id is the URL of a metadata document: https, with a path, and without the
 * parts a URL can hide things in. The default port only, since that is all that is fetched.
 */
export function isDocumentClientId(clientId: string): boolean {
  if (clientId.length > MAX_CLIENT_ID_LENGTH || hasForbiddenCodePoint(clientId)) {
    return false;
  }
  const url = URL.parse(clientId);
  return (
    url !== null &&
    url.protocol === "https:" &&
    url.href === clientId &&
    url.pathname !== "/" &&
    !url.pathname.split("/").some((segment) => segment === "." || segment === "..") &&
    url.hash === "" &&
    !clientId.includes("#") &&
    url.username === "" &&
    url.password === "" &&
    url.port === ""
  );
}

export interface OAuthClientsOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetchDocument: DocumentFetcher;
  /** In place of the built-in bound on clients nobody has used. */
  readonly maxUnusedClients?: number;
}

export class OAuthClients {
  readonly #options: OAuthClientsOptions;
  readonly #fetching = new Map<string, Promise<OAuthClientRecord | undefined>>();
  /** Documents that could not be read, and until when they are left alone. */
  readonly #failed = new Map<string, number>();
  /** How many unused clients there were when last counted, plus the ones stored here since. */
  #unused: { count: number; until: number } | undefined;

  constructor(options: OAuthClientsOptions) {
    this.#options = options;
  }

  /**
   * Makes room for one more client nobody has used yet, or rejects with a
   * {@link ClientLimitError}. The count is the database's, asked for now and then; replicas
   * each keep their own, so the bound holds to within what they store between two counts.
   */
  async #admit(): Promise<void> {
    const { database, clock } = this.#options;
    const now = clock.now().getTime();
    if (this.#unused === undefined || this.#unused.until <= now) {
      this.#unused = {
        count: await countUnusedOAuthClients(database),
        until: now + UNUSED_COUNT_TTL_MS,
      };
    }
    if (this.#unused.count >= (this.#options.maxUnusedClients ?? MAX_UNUSED_CLIENTS)) {
      throw new ClientLimitError();
    }
    this.#unused.count += 1;
  }

  /**
   * Registers a client from what it says about itself (RFC 7591). Anyone may register: a
   * registration grants nothing until a person agrees to it on the consent page. Answers with
   * the secret when the client asked to prove itself with one; it is not stored and not shown
   * again.
   */
  async register(
    metadata: unknown,
  ): Promise<{ readonly client: OAuthClientRecord; readonly secret: string | undefined }> {
    const facts = readMetadata(metadata);
    const requested = facts.requestedAuthMethod ?? "none";
    const authMethod: OAuthClientAuthMethod | undefined =
      requested === "none" ? "none" : SECRET_METHODS.find((method) => method === requested);
    if (authMethod === undefined) {
      throw new ClientMetadataError(
        "invalid_client_metadata",
        "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.",
      );
    }
    await this.#admit();
    const secret = authMethod === "none" ? undefined : newToken("scdn_cs_");
    const client = await saveOAuthClient(
      this.#options.database,
      {
        clientId: newToken("scdn_client_"),
        source: "registration",
        name: facts.name,
        uri: facts.uri,
        redirectUris: facts.redirectUris,
        authMethod,
        secretHash: secret === undefined ? undefined : hashToken(secret),
        freshUntil: undefined,
      },
      this.#options.clock.now(),
    );
    return { client, secret };
  }

  /** The client a request names, or nothing: unknown, or a document that cannot be read. */
  async find(clientId: string): Promise<OAuthClientRecord | undefined> {
    if (clientId.length === 0 || clientId.length > MAX_CLIENT_ID_LENGTH) {
      return undefined;
    }
    const { database, clock } = this.#options;
    const known = await findOAuthClient(database, clientId);
    if (!isDocumentClientId(clientId)) {
      return known?.source === "registration" ? known : undefined;
    }
    const now = clock.now().getTime();
    if (known?.freshUntil !== undefined && known.freshUntil.getTime() > now) {
      return known;
    }
    if ((this.#failed.get(clientId) ?? 0) > now) {
      return known;
    }
    let fetching = this.#fetching.get(clientId);
    if (fetching === undefined) {
      fetching = this.#readDocument(clientId, known).finally(() => {
        this.#fetching.delete(clientId);
      });
      this.#fetching.set(clientId, fetching);
    }
    return fetching;
  }

  /**
   * Fetches the document a client identifies itself with and stores what it says. A document
   * that cannot be read leaves the copy that was read before standing, when there is one.
   */
  async #readDocument(
    clientId: string,
    known: OAuthClientRecord | undefined,
  ): Promise<OAuthClientRecord | undefined> {
    const { database, clock, logger, fetchDocument } = this.#options;
    try {
      // A document never seen before is one more client nobody has used yet, and when there
      // is no room for one, nothing is fetched for it either.
      if (known === undefined) {
        await this.#admit();
      }
      const document = await fetchDocument(new URL(clientId));
      const body = document.body;
      // The document has to say that it is this client's: a URL that merely serves someone
      // else's document is not that client.
      if (
        typeof body !== "object" ||
        body === null ||
        !("client_id" in body) ||
        body.client_id !== clientId
      ) {
        throw new ClientMetadataError(
          "invalid_client_metadata",
          "The document's client_id is not its own URL.",
        );
      }
      const facts = readMetadata(body);
      // A shared secret cannot live in a public document, so a client that asks for one in
      // its document is not saying what it means.
      if (SECRET_METHODS.some((method) => method === facts.requestedAuthMethod)) {
        throw new ClientMetadataError(
          "invalid_client_metadata",
          "A metadata document cannot ask for a client secret.",
        );
      }
      const now = clock.now();
      const keep = Math.min(
        Math.max(document.maxAgeMs ?? DOCUMENT_TTL_MS, MIN_DOCUMENT_TTL_MS),
        MAX_DOCUMENT_TTL_MS,
      );
      return await saveOAuthClient(
        database,
        {
          clientId,
          source: "document",
          name: facts.name,
          uri: facts.uri,
          redirectUris: facts.redirectUris,
          authMethod: "none",
          secretHash: undefined,
          freshUntil: new Date(now.getTime() + keep),
        },
        now,
      );
    } catch (error) {
      logger.info(
        { err: error, known: known !== undefined },
        error instanceof ClientLimitError
          ? "a client metadata document was not fetched: too many clients nobody has used"
          : "a client metadata document could not be read",
      );
      this.#failed.delete(clientId);
      this.#failed.set(clientId, clock.now().getTime() + DOCUMENT_RETRY_MS);
      if (this.#failed.size > MAX_REMEMBERED_FAILURES) {
        const oldest = this.#failed.keys().next().value;
        if (oldest !== undefined) {
          this.#failed.delete(oldest);
        }
      }
      return known;
    }
  }
}
