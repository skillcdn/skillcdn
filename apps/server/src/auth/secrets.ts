import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// What the deployment keeps secret for people (docs/specs/permissions.md): values it encrypts
// so that only it reads them back, and tokens it hands out and remembers only as hashes.

/** What a sealed value is for. Each purpose has a key of its own, so one cannot stand in for another. */
export type SealPurpose =
  /** The git host's credential of a user, as it is stored. */
  | "host-credential"
  /** What a sign-in is remembered by while the browser is away at the git host. */
  | "login"
  /** An authorization request on its way through the consent page. */
  | "authorization";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const TOKEN_BYTES = 32;

/**
 * Encrypts and authenticates with keys derived from the deployment's secret. A sealed value is
 * opaque and tamper-evident: `open` answers `undefined` for anything `seal` did not write for
 * the same purpose and context under the same secret, and never says why.
 */
export interface Secrets {
  /** `context` ties the value to its place, such as the user it belongs to. */
  seal(purpose: SealPurpose, plaintext: string, context?: string): string;
  open(purpose: SealPurpose, sealed: string, context?: string): string | undefined;
}

export function createSecrets(secret: string): Secrets {
  const keys = new Map<SealPurpose, Buffer>();
  const keyFor = (purpose: SealPurpose): Buffer => {
    let key = keys.get(purpose);
    if (key === undefined) {
      key = Buffer.from(hkdfSync("sha256", secret, "skillcdn", purpose, KEY_BYTES));
      keys.set(purpose, key);
    }
    return key;
  };

  return {
    seal(purpose, plaintext, context = "") {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return `${VERSION}.${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")}`;
    },
    open(purpose, sealed, context = "") {
      const [version, encoded, ...rest] = sealed.split(".");
      if (version !== VERSION || encoded === undefined || rest.length > 0) {
        return undefined;
      }
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.byteLength < IV_BYTES + TAG_BYTES) {
        return undefined;
      }
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          keyFor(purpose),
          bytes.subarray(0, IV_BYTES),
        );
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(bytes.subarray(bytes.byteLength - TAG_BYTES));
        return Buffer.concat([
          decipher.update(bytes.subarray(IV_BYTES, bytes.byteLength - TAG_BYTES)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Seals a small JSON value that is only good until `expiresAt`: what travels through a browser
 * between two requests to this deployment.
 */
export function sealJson(
  secrets: Secrets,
  purpose: SealPurpose,
  value: unknown,
  expiresAt: Date,
): string {
  return secrets.seal(purpose, JSON.stringify({ value, expiresAt: expiresAt.getTime() }));
}

/** What `sealJson` sealed, while it has not expired; the caller validates its shape. */
export function openJson(
  secrets: Secrets,
  purpose: SealPurpose,
  sealed: string,
  now: Date,
): unknown {
  const text = secrets.open(purpose, sealed);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("expiresAt" in parsed) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now.getTime() ||
      !("value" in parsed)
    ) {
      return undefined;
    }
    return parsed.value;
  } catch {
    return undefined;
  }
}

/**
 * A new secret to hand out once: random, unguessable, and prefixed so that a scanner that
 * finds one in a log or a repository knows what it found.
 */
export function newToken(prefix: string): string {
  return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

/** How a handed-out secret is remembered. It is random and long, so a plain hash is enough. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Equal without leaking how far the comparison got; the hashes make the lengths equal. */
export function sameSecret(presented: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

/** The S256 challenge of a PKCE verifier (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
