import type { Clock } from "@skillcdn/core";

// Pictures the server fetches to draw a social preview (ADR-0032): the owner's, from the git
// host. Fetched without credentials, bounded in size and time, kept for a while, and never
// served on: they are drawn into a card and nothing else.

/** The most bytes a picture may have; an avatar is a fraction of it. */
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5_000;
/** How long a fetched picture is kept, and how many. */
const KEEP_MS = 60 * 60 * 1000;
const MAX_KEPT = 512;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface Kept {
  readonly bytes: Uint8Array | undefined;
  readonly until: number;
}

export class PictureFetcher {
  readonly #fetch: Fetch;
  readonly #clock: Clock;
  readonly #kept = new Map<string, Kept>();
  readonly #loading = new Map<string, Promise<Uint8Array | undefined>>();

  constructor(options: { readonly fetch: Fetch; readonly clock: Clock }) {
    this.#fetch = options.fetch;
    this.#clock = options.clock;
  }

  /** The bytes of the picture at `url`, or nothing: an `https` URL that answers with an image. */
  async get(url: string): Promise<Uint8Array | undefined> {
    if (!/^https:\/\//i.test(url)) {
      return undefined;
    }
    const now = this.#clock.now().getTime();
    const kept = this.#kept.get(url);
    if (kept !== undefined && kept.until > now) {
      return kept.bytes;
    }
    let loading = this.#loading.get(url);
    if (loading === undefined) {
      loading = this.#load(url).finally(() => this.#loading.delete(url));
      this.#loading.set(url, loading);
    }
    return loading;
  }

  async #load(url: string): Promise<Uint8Array | undefined> {
    let bytes: Uint8Array | undefined;
    try {
      const response = await this.#fetch(url, {
        redirect: "follow",
        credentials: "omit",
        headers: { accept: "image/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      const length = Number(response.headers.get("content-length") ?? "0");
      if (response.ok && type.startsWith("image/") && length <= MAX_PICTURE_BYTES) {
        const body = new Uint8Array(await response.arrayBuffer());
        bytes = body.byteLength <= MAX_PICTURE_BYTES ? body : undefined;
      } else {
        await response.body?.cancel();
      }
    } catch {
      bytes = undefined;
    }
    this.#remember(url, bytes);
    return bytes;
  }

  #remember(url: string, bytes: Uint8Array | undefined): void {
    // A miss is remembered too, so that a host that has no picture is not asked again at once.
    for (const [oldest] of this.#kept) {
      if (this.#kept.size < MAX_KEPT) break;
      this.#kept.delete(oldest);
    }
    this.#kept.set(url, { bytes, until: this.#clock.now().getTime() + KEEP_MS });
  }
}
