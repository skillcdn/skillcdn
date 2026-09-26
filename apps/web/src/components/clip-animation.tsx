import type { RestShowcaseEntry } from "@skillcdn/core";

/**
 * The concept clip as an animated image, for a browser that will not play the video by itself
 * even muted (Samsung Internet can be set to, and phones saving power do too), but still
 * animates images. AVIF, because it is a fraction of the size of an animated WebP at the full
 * frame rate; a browser that cannot read it, and an entry without one, show the poster instead.
 */
export function ClipAnimation(props: { readonly entry: RestShowcaseEntry; readonly alt: string }) {
  const { media, width, height } = props.entry;
  return (
    <picture>
      {media.animation !== null && (
        <source srcSet={media.animation.url} type={media.animation.type} />
      )}
      <img src={media.poster.url} alt={props.alt} width={width} height={height} />
    </picture>
  );
}

/** Whether a start was refused rather than interrupted, by leaving the screen for one. */
export function isRefusal(error: unknown): boolean {
  return !(error instanceof DOMException && error.name === "AbortError");
}
