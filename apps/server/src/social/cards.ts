import type { Clock, SocialCard } from "@skillcdn/core";
import type { Logger } from "../logger.js";
import { drawSocialCard, registerCardFonts } from "./card.js";
import type { PictureFetcher } from "./pictures.js";

// The social previews of addresses (ADR-0032): drawn on demand from the card the web build
// writes for a page, with the owner's picture fetched from the git host, and kept for a while
// under the key the page gives them, so that a burst of unfurls draws each once. The fetcher
// is shared with the icon route, so that one fetch of a picture serves both.

/** How long a drawn card is kept, and how many. A card is a hundred kilobytes or so. */
const KEEP_MS = 60 * 60 * 1000;
const MAX_KEPT = 256;

interface Kept {
  readonly bytes: Uint8Array;
  readonly until: number;
}

export class SocialCards {
  readonly #pictures: PictureFetcher;
  readonly #clock: Clock;
  readonly #kept = new Map<string, Kept>();
  readonly #drawing = new Map<string, Promise<Uint8Array>>();

  constructor(options: {
    readonly pictures: PictureFetcher;
    readonly clock: Clock;
    readonly logger: Logger;
    /** The font files of the web build; without them the system's fonts stand in. */
    readonly fonts: readonly string[];
  }) {
    this.#pictures = options.pictures;
    this.#clock = options.clock;
    const { registered } = registerCardFonts(options.fonts);
    if (options.fonts.length > 0 && registered === 0) {
      options.logger.warn(
        { fonts: options.fonts },
        "no font of the web build could be registered; social cards use the system's fonts",
      );
    }
  }

  /**
   * The PNG of `card`, drawn once per `key` and kept. The key names everything the card was
   * made from: the language, the address, the commit, the skill, and how far the index was.
   */
  async picture(key: string, card: SocialCard): Promise<Uint8Array> {
    const now = this.#clock.now().getTime();
    const kept = this.#kept.get(key);
    if (kept !== undefined && kept.until > now) {
      return kept.bytes;
    }
    let drawing = this.#drawing.get(key);
    if (drawing === undefined) {
      drawing = this.#draw(key, card).finally(() => this.#drawing.delete(key));
      this.#drawing.set(key, drawing);
    }
    return drawing;
  }

  async #draw(key: string, card: SocialCard): Promise<Uint8Array> {
    const avatar = await this.#pictures.get(card.avatar);
    const bytes = await drawSocialCard(card, avatar);
    for (const [oldest] of this.#kept) {
      if (this.#kept.size < MAX_KEPT) break;
      this.#kept.delete(oldest);
    }
    this.#kept.set(key, { bytes, until: this.#clock.now().getTime() + KEEP_MS });
    return bytes;
  }
}
