import {
  BRAND_LOCKUP_WIDTH,
  BRAND_SYMBOL_COLOR,
  BRAND_SYMBOL_PATH,
  BRAND_WORDMARK_PATH,
} from "@skillcdn/core";

// The mark of the site, drawn from the path data in core so that the pages, the files under
// public/brand/ and the social previews the server draws all show one shape. The symbol keeps its
// own blue wherever it stands; the wordmark takes the colour of its place, which on these pages is
// the brand's white (`--color-wordmark`), the same white the brand files are drawn in.

/** The symbol alone, in a square box. Decorative: whatever it stands beside names it. */
export function BrandSymbol(props: { readonly className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 100 100"
      width="32"
      height="32"
      aria-hidden="true"
    >
      <path fill={BRAND_SYMBOL_COLOR} d={BRAND_SYMBOL_PATH} />
    </svg>
  );
}

/**
 * The symbol and the wordmark together. With a `title` it is an image that names the site; without
 * one it is decorative, for a place that already has a name of its own.
 */
export function BrandLogo(props: { readonly className?: string; readonly title?: string }) {
  const paths = (
    <>
      <path fill={BRAND_SYMBOL_COLOR} d={BRAND_SYMBOL_PATH} />
      <path fill="currentColor" d={BRAND_WORDMARK_PATH} />
    </>
  );
  const size = {
    viewBox: `0 0 ${BRAND_LOCKUP_WIDTH} 100`,
    width: BRAND_LOCKUP_WIDTH * 0.3,
    height: 30,
  };
  return props.title === undefined ? (
    <svg className={props.className} {...size} aria-hidden="true">
      {paths}
    </svg>
  ) : (
    <svg className={props.className} {...size} role="img" aria-label={props.title}>
      <title>{props.title}</title>
      {paths}
    </svg>
  );
}
