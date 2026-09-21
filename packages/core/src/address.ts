import { isFullCommitHash, isValidRefName } from "./git-ref.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";
import { err, ok, type Result } from "./result.js";
import { hasForbiddenCodePoint } from "./text-safety.js";

// Grammar and semantics: docs/specs/address.md.

export const MAX_ADDRESS_LENGTH = 2048;

/** Git hosts an address can name. `gh` is GitHub. */
export const GIT_HOST_KEYS = ["gh"] as const;
export type GitHostKey = (typeof GIT_HOST_KEYS)[number];

export type AddressRef =
  /** A full commit hash, lowercase. The address is pinned: its content never changes. */
  | { readonly kind: "commit"; readonly hash: string }
  /** A branch, a tag or anything else the host resolves. The address is moving. */
  | { readonly kind: "name"; readonly name: string };

export interface Address {
  readonly host: GitHostKey;
  /** Canonical spelling: lowercase on hosts that match names case-insensitively. */
  readonly owner: string;
  readonly repo: string;
  /** `undefined` means the default branch. */
  readonly ref: AddressRef | undefined;
  /** Directory the address mounts; the root path mounts the whole repository. */
  readonly path: RepoPath;
}

export type AddressErrorCode =
  | "not_absolute"
  | "too_long"
  | "bad_encoding"
  | "forbidden_character"
  | "empty_segment"
  | "dot_segment"
  | "unknown_host"
  | "missing_repo"
  | "invalid_owner"
  | "invalid_repo"
  | "empty_ref"
  | "invalid_ref"
  | "invalid_path";

export interface AddressError {
  readonly code: AddressErrorCode;
  readonly message: string;
}

interface HostNamingRules {
  readonly owner: RegExp;
  readonly repo: RegExp;
  readonly caseInsensitive: boolean;
}

const HOST_NAMING_RULES: Record<GitHostKey, HostNamingRules> = {
  gh: {
    // Managed-user accounts carry an underscore suffix, so "_" is allowed after the first character.
    owner: /^[a-z0-9][a-z0-9_-]{0,38}$/i,
    repo: /^[a-z0-9._-]{1,100}$/i,
    caseInsensitive: true,
  },
};

function fail(code: AddressErrorCode, message: string): Result<Address, AddressError> {
  return err({ code, message });
}

function isGitHostKey(value: string): value is GitHostKey {
  return (GIT_HOST_KEYS as readonly string[]).includes(value);
}

function decodeSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parses the path of an endpoint URL, for example `/gh/acme/skills@v1.2.0/marketing`.
 * Total: every input yields an address or a typed error, and nothing here touches the network.
 */
export function parseAddress(input: string): Result<Address, AddressError> {
  if (!input.startsWith("/")) {
    return fail("not_absolute", 'an address starts with "/"');
  }
  if (input.length > MAX_ADDRESS_LENGTH) {
    return fail("too_long", `an address is at most ${MAX_ADDRESS_LENGTH} characters`);
  }

  const segments: string[] = [];
  for (const raw of input.slice(1).split("/")) {
    if (raw.length === 0) {
      return fail("empty_segment", "an address has no empty segments and no trailing slash");
    }
    const segment = decodeSegment(raw);
    if (segment === undefined) {
      return fail("bad_encoding", "an address must be valid percent-encoded UTF-8");
    }
    // An encoded slash would mean different things before and after a proxy decodes it.
    if (segment.includes("/") || segment.includes("\\") || hasForbiddenCodePoint(segment)) {
      return fail(
        "forbidden_character",
        "an address has no encoded slashes, backslashes or control characters",
      );
    }
    if (segment === "." || segment === "..") {
      return fail("dot_segment", 'an address has no "." or ".." segments');
    }
    segments.push(segment);
  }

  const [host, owner, repoSegment, ...rest] = segments;
  if (host === undefined || !isGitHostKey(host)) {
    return fail("unknown_host", `unknown git host; expected one of: ${GIT_HOST_KEYS.join(", ")}`);
  }
  if (owner === undefined || repoSegment === undefined) {
    return fail("missing_repo", "an address names an owner and a repository");
  }
  const rules = HOST_NAMING_RULES[host];
  if (!rules.owner.test(owner)) {
    return fail("invalid_owner", "the owner is not a valid account name on this git host");
  }

  const at = repoSegment.indexOf("@");
  const repo = at < 0 ? repoSegment : repoSegment.slice(0, at);
  if (!rules.repo.test(repo) || repo === "." || repo === ".." || /\.git$/i.test(repo)) {
    return fail("invalid_repo", "the repository is not a valid repository name on this git host");
  }

  let ref: AddressRef | undefined;
  let pathInput: string;
  if (at < 0) {
    pathInput = rest.join("/");
  } else {
    // The ref ends at the first ":" if there is one, otherwise at the first "/".
    const tail = [repoSegment.slice(at + 1), ...rest].join("/");
    const colon = tail.indexOf(":");
    const end = colon >= 0 ? colon : tail.indexOf("/");
    const refText = end < 0 ? tail : tail.slice(0, end);
    pathInput = end < 0 ? "" : tail.slice(end + 1);
    if (refText.length === 0) {
      return fail("empty_ref", 'a ref follows "@"');
    }
    if (isFullCommitHash(refText)) {
      ref = { kind: "commit", hash: refText.toLowerCase() };
    } else if (isValidRefName(refText)) {
      ref = { kind: "name", name: refText };
    } else {
      return fail("invalid_ref", "the ref is not a valid git ref name");
    }
  }

  const path = parseRepoPath(pathInput);
  if (!path.ok) {
    return fail("invalid_path", path.error.message);
  }

  return ok({
    host,
    owner: rules.caseInsensitive ? owner.toLowerCase() : owner,
    repo: rules.caseInsensitive ? repo.toLowerCase() : repo,
    ref,
    path: path.value,
  });
}

function encodeSlashSeparated(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment).replaceAll("%40", "@").replaceAll("%3A", ":"))
    .join("/");
}

/** The canonical spelling of an address. `formatAddress(parseAddress(x).value)` is the canonical form of `x`. */
export function formatAddress(address: Address): string {
  const repo = `/${address.host}/${address.owner}/${address.repo}`;
  const path = encodeSlashSeparated(address.path);
  if (address.ref === undefined) {
    return path.length === 0 ? repo : `${repo}/${path}`;
  }
  const refText = address.ref.kind === "commit" ? address.ref.hash : address.ref.name;
  const mounted = `${repo}@${encodeSlashSeparated(refText)}`;
  // Without the explicit terminator, a "/" in the ref or a ":" in the path would be read back differently.
  if (refText.includes("/") || address.path.includes(":")) {
    return `${mounted}:${path}`;
  }
  return path.length === 0 ? mounted : `${mounted}/${path}`;
}

/** Pinned addresses name a full commit hash and may be cached indefinitely; everything else moves. */
export function isPinnedAddress(address: Address): boolean {
  return address.ref?.kind === "commit";
}
