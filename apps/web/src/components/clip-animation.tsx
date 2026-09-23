import { FEATURED_VIDEO } from "../site.js";

/**
 * The concept clip as an animated image, for a browser that will not play the video by itself
 * even muted (Samsung Internet can be set to, and phones saving power do too), but still
 * animates images. AVIF, because it is a fraction of the size of an animated WebP at the full
 * frame rate; a browser that cannot read AVIF shows the poster instead.
 */
export function ClipAnimation(props: { readonly alt: string }) {
  return (
    <picture>
      <source srcSet={FEATURED_VIDEO.animation} type="image/avif" />
      <img
        src={FEATURED_VIDEO.poster}
        alt={props.alt}
        width={FEATURED_VIDEO.width}
        height={FEATURED_VIDEO.height}
      />
    </picture>
  );
}

/** Whether a start was refused rather than interrupted, by leaving the screen for one. */
export function isRefusal(error: unknown): boolean {
  return !(error instanceof DOMException && error.name === "AbortError");
}
